# Fork updates

Open **Fork updates** from the sidebar to see commits on `pingdotgg/t3code`'s
`main` branch that are missing from the published `Moinax/t3code` fork. Search by
message, author or SHA, and open a commit to read its diff on GitHub.

The count compares published branches. It does not include unpublished local
work or tell you which version of the app is running. Cherry-picked commits
can still appear because their commit IDs differ. Checks run every 15 minutes
while the app is active. **Refresh** checks the count and local update status
on demand. GitHub request limits may delay the next count check.

In the Linux fork desktop app, **Prepare update** prepares a new version on this
computer. It uses a separate checkout, preserves your working directory and
starts from the published fork. Publish local fork commits before starting.
If you commit more local work during preparation, publication stops so that
you can reconcile those changes.

Sol High Fast handles conflicts and failed checks, with up to two repair
attempts. After the checks and build pass, the updater pushes the verified
commit and installs the matching app. **Restart** becomes available when it is
ready. The previous app stays running until you choose to restart.

You can inspect the activity, cancel preparation or retry a failed update.
Publication and installation finish before cancellation is allowed. Closing
T3 Code does not cancel the job; reopening reconnects to its status. Jobs stop
after two hours. Retries use a fresh checkout and keep failed work for inspection.

Preparation is manual. It requires the local fork checkout, Git, Node, Vite+
and a signed-in Codex CLI, and uses the Linux user service manager. Connecting
to a remote environment still updates this desktop; it does not deploy the
remote server. The web client retains the commit list without local update
controls.
