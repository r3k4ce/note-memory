---
title: '#git #programming'
summary: "#git #programming \n# What is Git?\n\n- Git is a Distributed Version Control\
  \ System (DVCS).\n- Records changes to files over time and allows recalling specific\
  \ versions.\n- Enables reverting selected files or entire projects to previous states.\n\
  - Facilita"
tags: []
category: Tutorials
---

#git #programming 
# What is Git?

- Git is a Distributed Version Control System (DVCS).
- Records changes to files over time and allows recalling specific versions.
- Enables reverting selected files or entire projects to previous states.
- Facilitates comparison of changes over time.
- Helps identify who last modified files and introduced issues.
- Provides easy recovery of lost files or mistakes in development.
- Clients mirror the repository along with its history.
- Each client retains a copy of the repository to restore lost data if a server fails.

![[distributed.png]]

# Configure Git and Github

```bash
git config --global user.name "Your Name"
git config --global user.email "Your email"
```

If you set your email as private on Github, then you would use it instead of your actual email.

```bash
git config --global user.email "123456789+odin@users.noreply.github.com"
```

Change the default branch for Git

```bash
git config --global init.defaultBranch main
```

Enable colorful output

```bash
git config --global color.ui auto
```

Set default branch reconciliation behavior to merging

```bash
git config --global pull.rebase false
```

Verify if git is set up properly

```bash
git config --get user.name
git config --get user.email
```

# Create SSH Key

```shell
ssh-keygen -t ed25519
```

# Git Commands

Clone a repository using SSH.

```shell
git clone git@github.com:USER-NAME/REPOSITORY-NAME.git
```

Show the git status of files in current directory.

```shell
git status
```

Add file to staging area. The staging area is part of a two step process for making a commit in Git. The staging area works as a pre commit where changes to files are stored before they are committed.

```shell
git add filename
```

Commit changes and add a commit message.

```shell
git commit -m "Commit Message"
```

View the git log for the repository at the current directory.

```shell
git log
```

Push the changes to a remote repository such as Github.

```shell
git push origin main
```

