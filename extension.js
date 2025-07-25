/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { jira_client_from_config } from './client/jira_client.js';
import { WorkJournal } from './client/work_journal.js';
import { TempomateService } from './dbus/tempomate_service.js';
import { CurrentIssueMenuItem, EditableMenuItem, IdleMenuItem, IssueMenuItem } from './ui/menuitem.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { NotificationStateMachine } from './ui/notification_state_machine.js';
import { between, Duration } from './date/duration.js';
import { debug } from './utils/log.js';
import { destroy as destroy_timers, managedTimer, interval } from './utils/utils.js';
import { hhmmTimeString } from './date/date.js';

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(settings) {
            super._init(0.0, _('Tempomate'));

            this.label = new St.Label({
                style_class: 'panel-button',
                text: '○',
                y_align: Clutter.ActorAlign.CENTER
            });
            this.add_child(this.label);
            this.setMenu(new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP, 0));
            this.settings = settings;
            this._notification_state_machine = new NotificationStateMachine();
            this._restore()
            this._settingsChangedId = this.settings.connect('changed', this._settingsChanged.bind(this));
            this._settingsChanged();

            // Sprawdzenie połączenia do Jira
            this._jira_connection_ok = true;
            this.client.check_connection?.(
                () => {
                    this._jira_connection_ok = true;
                    this.update_label();
                },
                () => {
                    this._jira_connection_ok = false;
                    this.update_label();
                }
            );

            this.menu.connect("open-state-changed", this.updateUI.bind(this))
            this.dbus_service = new TempomateService(this.fetch_and_start_or_continue_work.bind(this));

            this.update_label_interval = interval(Duration.ofSeconds(60), Duration.ofSeconds(60), () => this.update_label(), "update label");

            this.issue_refresh_interval = interval(Duration.ofSeconds(900), Duration.ofSeconds(900), () => this._refreshFilters(), "refresh issues");
        }

        _restore() {
            this.issues = JSON.parse(this.settings.get_string("issue-cache"));
            this.recent_issues = this.settings.get_strv("recent-issues")
                .map((i) => JSON.parse(i))
                .filter((issue) => issue.key && issue.fields);
        }

        _settingsChanged() {
            this.default_duration = Duration.ofSeconds(this.settings.get_int("default-duration") * 60);
            this.queries = this.settings.get_strv('jqls').map((s) => JSON.parse(s));
            this.client = jira_client_from_config(this.settings);
            this._work_journal = new WorkJournal(this.settings, () => this.client.tempo());
            if (this._work_journal.current_work()) {
                // set up stop timer if recent work has been restored
                const remaining = between(new Date(), this._work_journal.current_work().end());
                if (remaining.toSeconds() > 0) {
                    this.stop_work_timeout?.();
                    this.stop_work_timeout = managedTimer(remaining, () => this.stop_work(), "stop work timeout (settings changed)");
                }
            }
            this._refreshFilters();
            this.update_label();
            this.updateUI(this.menu, true);

            this._notification_state_machine.update_settings({
                idle_notifications: this.settings.get_boolean("nag-notifications"),
                idle_notification_interval: this.settings.get_int("nag-notification-interval")
            })
        }

        updateUI(menu, opened) {
            if (!opened || !this._work_journal) {
                return;
            }
            debug("Menu opened -  updating ", this._work_journal.current_work())
            this.menu.removeAll();

            if (!this._work_journal.current_work()) {
                this.menu.addMenuItem(new IdleMenuItem(this._notification_state_machine.snoozed_until(),
                    {
                        text: "😴+15m",
                        tooltip: "Snooze for 15 more minutes",
                        callback: () => {
                            this._notification_state_machine.add_snooze();
                            this.update_label();
                            this.menu.close(true);
                        }
                    }
                ));
            }

            let skip_first = false;
            if (this._work_journal.current_work() && this.recent_issues[0]?.id == this._work_journal.current_work().issueId()) {
                let current_issue = this.recent_issues[0];
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Current Issue')));
                const current_issue_menu = new PopupMenu.PopupMenuSection()
                const item = new CurrentIssueMenuItem(current_issue,
                    this._work_journal.current_work(),
                    {
                        icon: "media-playback-pause-symbolic",
                        tooltip: "Stop work",
                        callback: () => {
                            this.stop_work();
                            this.menu.close(true);
                        }
                    });
                item.connect('activate', () => this.start_or_continue_work(current_issue));
                current_issue_menu.addMenuItem(item);
                this.menu.addMenuItem(current_issue_menu);
                skip_first = true;
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Recent Issues')));

            const recent_issues_menu = new PopupMenu.PopupMenuSection()
            for (const issue in this.recent_issues) {
                if (!skip_first || issue > 0) {
                    recent_issues_menu.addMenuItem(this.generateMenuItem(this.recent_issues[issue]));
                }
            }
            this.menu.addMenuItem(recent_issues_menu);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Filters')));

            for (const q in this.queries) {

                let section = new PopupMenu.PopupSubMenuMenuItem(this.queries[q].name, true);

                for (const issue in this.issues[this.queries[q].name]) {
                    section.menu.addMenuItem(this.generateMenuItem(this.issues[this.queries[q].name][issue]));
                }
                this.menu.addMenuItem(section);
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Other issues')));
            const editableMenuItem = new EditableMenuItem({
                icon: "media-playback-start-symbolic",
                tooltip: "Start work",
                callback: issueId => {
                    this.fetch_and_start_or_continue_work(
                        issueId,
                        loaded_issue => this.menu.close(true),
                        error => editableMenuItem.set_error?.(`Unable to load issue ${issueId}`));
                }
            })
            this.menu.addMenuItem(editableMenuItem);
        }

        generateMenuItem(issue, ...actions) {
            const item = new IssueMenuItem(issue, ...actions);
            item.connect('activate', () => this.start_or_continue_work(issue));
            return item;
        }

        fetch_and_start_or_continue_work(issueKey, success_handler, error_handler) {
            this.client.issue(issueKey,
                jira_issue => {
                    success_handler?.(jira_issue);
                    this.start_or_continue_work(jira_issue);
                },
                error_handler)
        }


        start_or_continue_work(issue) {
            if (!issue || !issue.id) {
                return
            }
            debug("starting work " + issue.key)
            this.add_recent_issue(issue);
            this._work_journal.start_work(issue.id, this.default_duration, () => this.update_label());

            this.stop_work_timeout?.();
            this.stop_work_timeout = managedTimer(this.default_duration, () => this.stop_work(), "stop work timeout (start work)");
        }

        // Add an issue to recent issues and update the UI
        add_recent_issue(issue) {
            this.recent_issues = this.recent_issues.filter((e) => e.id !== issue.id);
            if (this.recent_issues.unshift(issue) > 5) {
                this.recent_issues.length = 5;
            }
            this._save_state();
        }

        stop_work() {
            if (!this._work_journal?.current_work()) {
                // nothing to do
                return;
            }
            debug("stopping work")
            this._notification_state_machine.stop_work();

            this.stop_work_timeout?.();
            this._work_journal.stop_work();
            this.update_label();
        }

        update_label() {
            if (this._jira_connection_ok === false) {
                this.label.set_text('🛠️ Check connection');
                this.label.set_style_class_name('panel-button');
                return;
            }

            const current_work = this._work_journal?.current_work();
            const snoozed_until = this._notification_state_machine.snoozed_until?.();

            if (!current_work && snoozed_until && new Date() < snoozed_until) {
                this.label.set_text(`☕ ${hhmmTimeString(snoozed_until)}`);
                this.label.set_style_class_name('panel-button');
                return;
            }

            if (current_work) {
                const issue = this.issue_of(current_work);
                const remaining_duration = between(new Date(), current_work.end());
                this.label.set_text(`${issue.key} (${remaining_duration.toMinutes()}m remaining)`);
                this.label.set_style_class_name('panel-button');
                this._notification_state_machine.start_work(issue, `${remaining_duration.toMinutes()} minutes remaining`);
                return;
            }

            const today = new Date();
            const workdays = new Set(this.settings.get_strv('workdays'));
            const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][today.getDay()];
            const workedDuration = this._work_journal?.getWorkedDurationForDate?.(today);
            const workedStr = workedDuration ? `${Math.floor(workedDuration.toMinutes() / 60)}:${(workedDuration.toMinutes() % 60).toString().padStart(2, '0')}` : '0:00';

            if (workdays.has(dayKey)) {
                this.label.set_text(`● idle ${workedStr}`);
                this.label.set_style_class_name('panel-button workday-red');
            } else {
                this.label.set_text(`○ off ${workedStr}`);
                this.label.set_style_class_name('panel-button weekend-gray');
            }
        }

        issue_of(worklog) {
            const recent = this.recent_issues.find(issue => issue.id == worklog.issueId())
            if (recent) {
                return recent;
            }

            const filtered = this.issues.values().flat().find(issue => issue.id == worklog.issueId())
            if (filtered) {
                return filtered;
            }

            // current fallback
            return ({
                id: worklog.issueId(),
                key: "unkown"
            })
        }

        _refreshFilters() {
            for (const q in this.queries) {
                this.client.filter(this.queries[q].jql, (result) => this.issues[this.queries[q].name] = result.issues)
            }
        }

        destroy() {
            this._save_state();
            this.stop_work_timeout?.();
            this.update_label_interval?.();
            this.issue_refresh_interval?.();

            this._notification_state_machine.destroy();
            this._work_journal?.destroy();
            this.dbus_service.destroy();
            this.settings.disconnect(this._settingsChangedId);
            this.settings = null;

            super.destroy();
        }

        _save_state() {
            this.settings.set_strv("recent-issues", this.recent_issues.map((ri) => JSON.stringify(ri)));
            this.settings.set_string("issue-cache", JSON.stringify(this.issues));
        }
    });

export default class TempomateExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        this._indicator = new Indicator(this.getSettings());
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        debug("disabling tempomate");
        this._indicator?.destroy();
        this._indicator = null;
        destroy_timers();
        debug("tempomate disabled");
    }
}
