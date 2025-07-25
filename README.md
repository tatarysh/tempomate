# Tempomate

A Gnome Shell extension for mindless time tracking in Tempo Timesheets.

Track your time with three clicks or less.

## Configuration

Tempomate needs to be configured before you can start using it.

### Server Connection

To use this extension, configure your server connection and access credentials. Normally, the URL base just looks like
`https://<your-jira-hostname>` for Jira server / Data Center and `https://<your-subdomain>.atlassian.net` for Jira Cloud.
At present, only API token authentication
is supported. Please generate an API token in your Jira Profile (Jira Cloud: https://id.atlassian.com/manage-profile/security/api-tokens) and paste it into the dialog.
For Jira Cloud you need to generate a separate Tempo API Token. Note that Tempo API tokens have a maximum validity of 365 days and need to be replaced on a regular base.

![server connection](https://github.com/tatarysh/tempomate/blob/main/screenshots/server-connection.png?raw=true)

### JQL Filters

By default, the extension only shows open issues assigned to you. You can add more filters to show other issues as well.

![jql filters](https://github.com/tatarysh/tempomate/blob/main/screenshots/jql-filters.png?raw=true)

### Time tracking settings

Once configured, you can track your time by clicking on the issue you're currently working on. Tempomate automatically
adds a worklog with the configured duration to Tempo (default 1 hour). If the previous worklog entry stopped just a
couple of minutes before, Tempomate can close the gap by moving the start of the new worklog back to the end of the
previous one.

![time tracking](https://github.com/tatarysh/tempomate/blob/main/screenshots/time-tracking.png?raw=true)

### Nag notifications

Tempomate can remind you frequently to log your time if there is no current worklog.

![nag notifications](https://github.com/tatarysh/tempomate/blob/main/screenshots/nag-notifications.png?raw=true)

## Testing and Development

To test or develop Tempomate, you may want to run GNOME Shell in a nested Wayland session. This allows you to safely test GNOME Shell extensions in an isolated environment.

Run the following command:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

This will start a new GNOME Shell instance in a window, using Wayland. You can then install and test the extension without affecting your main session.

## Using Tempomate

After configuring Tempomate, you can open the menu in the top right corner and click on the issue you're working on.
Tempomate automatically adds a worklog with the configured duration.

![popup](https://github.com/tatarysh/tempomate/blob/main/screenshots/popup.png?raw=true)

You can click another issue at any time to start another worklog for the new issue. If the previous worklog was still
ongoing at that time, it will be updated to end at that time. If the previous worklog ended less than the configured gap
time ago, the new worklog will start at the time the previous log ended.

While a worklog is active, a notification will be shown.

![worklog-notification](https://github.com/tatarysh/tempomate/blob/main/screenshots/worklog-notification.png?raw=true)

When no worklog is active and the nag notification is enabled, a notification will be shown at the configured interval.

![nag-notification](https://github.com/tatarysh/tempomate/blob/main/screenshots/nag-notification.png?raw=true)

## DBus Interface

You can start or extend a work-log by calling an interface via DBus like:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/rysh/gnome/shell/tempomate --method org.rysh.gnome.shell.tempomate.log_work ISSUE
```

With `ISSUE` being the issue ID of the ticket you're working on.

### Example: Git Post-checkout Hook

You can use this interface to create a work-log whenever you check out a branch that contains a Jira issue ID by
creating a post-checkout hook with the following content:

```bash
#!/bin/bash

BRANCH_CHECKOUT=$3

if [ "${BRANCH_CHECKOUT}" = "1" ] ; then
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        ISSUE=$(echo "${BRANCH}" | grep -P -o '\b[A-Z]+-\d+\b') && \
                gdbus call --session --dest org.gnome.Shell --object-path /org/rysh/gnome/shell/tempomate \
                --method org.rysh.gnome.shell.tempomate.log_work "${ISSUE}" > /dev/null || true
fi
```

## Sponsor

If Tempomate saves you time, effort or frustration by simplifying time tracking with Tempo Time Sheets, consider
becoming a sponsor to support its continued development. Your sponsorship helps ensure ongoing maintenance, 
new features, and smoother integration with GNOME Shell. For individuals or organizations, I can provide invoices
for contributions.

## License

Copyright (C) 2024 rysh

This program is free software; you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program; if not, write to the Free
Software Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.


