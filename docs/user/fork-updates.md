# Fork updates

Open **Fork updates** from the sidebar to see commits on `pingdotgg/t3code` that
are missing from the published `Moinax/t3code` fork. Search by message, author or
SHA, and open a commit to read its diff on GitHub.

The list stops at upstream's newest nightly release that actually built, not at
the tip of `main`. Upstream creates a nightly's tag and its release together,
once the checks and every desktop build have passed, so a tag with no release is
one whose release was withdrawn — a release carrying an uploaded AppImage is what
makes a commit eligible. Commits landed past that nightly are in no build
upstream has exercised, so they are neither listed nor taken, and the panel names
the nightly it is following.

The count compares published branches. It does not include unpublished local
work or tell you which version of the app is running. Cherry-picked commits
can still appear because their commit IDs differ. Checks run every 15 minutes
while the app is active. **Refresh** checks the count and local update status
on demand. GitHub request limits may delay the next count check.

In the Linux fork desktop app, a new nightly is prepared without being asked, as
long as none is already running and the checkout has no edits of its own — so the
only step left to you is **Restart**, whenever suits you. An update already
waiting for that restart does not hold the next one back: hours can pass before
you restart, and the build being replaced was never run. A run that fails is not
retried on its own, and the same nightly is never started twice. A local build
you asked for by hand is never replaced this way.

**What this update brings** lists the commit subjects, grouped so the features
and fixes come first and the tests, CI and reverts fold away. It counts from the
build you are running rather than from the checkout, so it stays right however
many updates stacked up while you were away, and it stays on screen after the
restart — which is when the question is usually asked.

The panel says the earliest upstream could next publish a nightly — it holds six
hours between them and only releases on the hour's eighth and thirty-eighth
minute, so there is always one to name. That is a floor, never a promise: a
maintainer can publish one by hand at any time, and one arriving sooner than
announced costs you nothing, since it installs itself.

**Go back a build** restores the last build this app actually started and
restarts onto it. Preparing further updates never replaces it, so it is always a
build you have run. Only one is kept; anything older is a rebuild from git. If an
update leaves the app unable to start, `t3fork rollback` in a terminal does the
same thing without needing the window.

**Update fork** does the same on demand, and updates the fork and this computer
together. Its name says what pressing it would accomplish: **Update fork** when
upstream commits are waiting, **Rebuild and publish** when the only thing
outstanding is work of your own — the count above compares published branches,
so it cannot see that, and the panel says how many commits are waiting — and
**Check for an update** when the fork, the checkout and the running app are all
level, where a run reaches GitHub, finds nothing and returns without building.
It is disabled outright while the checkout has uncommitted files, because a run
refuses to start over them. Commit unfinished work and select the fork branch before starting.
The update includes unpublished local commits that extend the published fork,
then rebases your fork patches onto upstream. Divergent local and published
histories need to be reconciled first.

Opus 5.5, at high effort, handles conflicts and failed checks, with up to two
repair attempts. Its fixes land in the fork patch they repair rather than in commits of
their own: conflicts are resolved inside the commit being replayed, and anything
found after the rebase is committed as a `fixup!` that the updater folds in. The
series stays one commit per fork patch, which is what keeps later rebases from
replaying old reconciliations. After the checks and build pass, the updater pushes the verified
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

A build installed from a terminal with `t3fork install` arrives the same way:
the sidebar offers its restart, and the change list names the commits it has that
the running build does not. It counts as a prepared local build, so an automatic
upstream update waits for the restart rather than replacing it. Unlike the button
above, it builds the checkout in place and its version carries the commit it was
built from rather than `local`.

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
