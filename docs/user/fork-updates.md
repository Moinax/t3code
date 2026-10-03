# Fork updates

Open **Fork updates** from the sidebar to see commits on `pingdotgg/t3code`'s
`main` branch that are missing from the published `Moinax/t3code` fork. Search by
message, author or SHA, and open a commit to read its diff on GitHub.

The count compares published branches. It does not include unpublished local
work or tell you which version of the app is running. Cherry-picked commits
can still appear because their commit IDs differ. Checks run every 15 minutes
while the app is active. **Refresh** checks the count and local update status
on demand. GitHub request limits may delay the next count check.

In the Linux fork desktop app, **Update fork** updates the fork and this computer
together. Commit unfinished work and select the fork branch before starting.
The update includes unpublished local commits that extend the published fork,
then rebases your fork patches onto upstream. Divergent local and published
histories need to be reconciled first.

Sol High Fast handles conflicts and failed checks, with up to two repair
attempts. After the checks and build pass, the updater pushes the verified
commit and installs the matching app. **Restart** becomes available when it is
ready. The local checkout and its dependencies are synchronized with the verified
commit too. No separate local build is needed. The previous app stays running
until you choose to restart. If you edit files or commit during preparation,
the update stops rather than overwriting your work. Check the activity for which
steps completed before retrying.

Under **Local development**, **Install local changes** builds the current contents of your local fork checkout,
including unpublished commits, uncommitted changes and new files that Git does
not ignore. It checks and builds a separate snapshot, leaving your working files,
staging area and branches unchanged. It does not fetch upstream changes, publish
commits or run automatic repairs. Fix a failed check locally and retry to take a
new snapshot.

The local build button stays disabled while your local files match the installed
build. It checks again with each status refresh, including after you edit or
revert files. Committing the same contents does not require another build.

You can build local changes while an upstream update is ready to restart. A
successful build replaces that prepared version. It includes upstream changes
only if they are already in your local checkout. If the build fails or you cancel
it, the previously prepared version remains available to restart. Local builds
have `local` in their version number.

Local installation has one action: install changes, cancel preparation, restart
when the local build is ready, or **Up to date** when there is nothing to install.
A prepared local build is restarted before installing further edits.

Local builds are for testing work in progress. They do not commit or publish
your changes. Commit that work before your next **Update fork** to include it
in the published fork.

You can inspect the activity, cancel preparation or retry a failed update.
Publication and installation finish before cancellation is allowed. Closing
T3 Code does not cancel the job; reopening reconnects to its status. Jobs stop
after two hours. Retries use a fresh checkout and keep failed work for inspection.

Preparation is manual. Both actions require the local fork checkout, Git, Node,
Vite+ and the Linux user service manager. Upstream preparation also requires a
signed-in Codex CLI. Connecting
to a remote environment still updates this desktop; it does not deploy the
remote server. The web client retains the commit list without local update
controls.
