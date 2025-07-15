import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export var WorkdaysSettingsPage = GObject.registerClass({
        GTypeName: 'WorkdaysSettingsPage',
    },
    class WorkdaysSettingsPage extends Adw.PreferencesPage {
        _init(settings) {
            super._init({
                title: "Work Schedule",
                icon_name: 'view-calendar-symbolic',
                name: 'WorkdaysSettingsPage'
            });

            const group = new Adw.PreferencesGroup({title: "Working Days"});

            const days = [
                { key: 'mon', label: 'Monday' },
                { key: 'tue', label: 'Tuesday' },
                { key: 'wed', label: 'Wednesday' },
                { key: 'thu', label: 'Thursday' },
                { key: 'fri', label: 'Friday' },
                { key: 'sat', label: 'Saturday' },
                { key: 'sun', label: 'Sunday' }
            ];
            const currentWorkdays = new Set(settings.get_strv('workdays'));

            days.forEach(day => {
                const checkbox = new Gtk.CheckButton({
                    label: day.label,
                    active: currentWorkdays.has(day.key),
                    halign: Gtk.Align.START
                });
                checkbox.connect('toggled', (btn) => {
                    let workdays = new Set(settings.get_strv('workdays'));
                    if (btn.active) {
                        workdays.add(day.key);
                    } else {
                        workdays.delete(day.key);
                    }
                    settings.set_strv('workdays', Array.from(workdays));
                });
                group.add(checkbox);
            });
            this.add(group);
        }
    }); 