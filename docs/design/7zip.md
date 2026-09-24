# 7-Zip compress and extract

Compress and extract run on the server through the system `7z` binary. There is no Go archive library and no shell: every argument is a separate `exec` parameter. The binary is probed the same way as ffmpeg. When it is missing, `/api/files/auth` reports `capabilities.archive: false` and the file menu does not show **7-Zip**.

## Probe

- A successful lookup is cached until the process exits. A miss is cached for 60 seconds, so installing 7-Zip does not require a restart.
- Linux and macOS: `PATH` entry `7z`.
- Windows: `PATH` entry `7z.exe`, then `ProgramFiles\7-Zip\7z.exe`, `ProgramFiles(x86)\7-Zip\7z.exe`, and the two literal `C:\Program Files` paths. There is no config key.
- The probe runs `7z i`. Extract extensions are the ones that build lists, so a zip container such as `.xlsx` is included. Compress formats are the create-capable types from a fixed catalog (zip, 7z, tar, gzip, bzip2, xz, wim) that this build actually marks with `C`.
- On Windows the child process is started with `CREATE_NO_WINDOW`, same as ffmpeg, so a service without a console does not flash a window.

`capabilities.archiveExtractExtensions` and `capabilities.archiveCompressFormats` come from that probe. The compress task payload carries `format`, which becomes `-t`.

## Commands

Compress, into a temporary zip in the destination directory:

```text
7z a -t<format> -bsp2 -bb3 -y -sccUTF-8 -scsUTF-8 -spd [-mem=AES256|-mhe=on] [-p<password>] <temp> @<listfile>
```

The working directory is the common parent of the selection. The listfile holds paths relative to that directory, so a selected folder is stored under its own name. Reserved `.fl-part-*` names are omitted while the list is built. `-spd` keeps names that contain `*` or `?` from being expanded; it also disables exclude wildcards, which is why the temporary names are filtered in Go instead of with `-x`.

`-p` and `-o` are one argument each (`-psecret`, `-o/dest`). A separate `-p` argument is an empty password.

A ZIP password selects WinZip AES-256 (`-mem=AES256`). A 7z password also encrypts filenames (`-mhe=on`). Other create formats reject a password. No password means the switch is omitted. The password is visible to `ps` because that is how 7-Zip accepts it. It is not written to the log and it is not part of the task snapshot. Retry reuses the password kept on the server task.

The temporary zip is renamed onto the destination only after 7-Zip exits successfully. Cancel deletes the temporary file.

Extract into the current folder:

```text
7z x -bsp2 -bb3 -y -sccUTF-8 -spd -ao<mode> [-p<password>] -o<dir> -- <archive>
```

`-aoa` overwrites, `-aos` skips existing files, `-aou` auto-renames. `-y` is always set so 7-Zip never waits on a prompt. The format is detected by 7-Zip; extract does not pass `-t`.

Before extract, `7z l -slt` lists entries. Top-level names that already exist in the folder go through the same conflict dialog as copy. A directory merging into a directory is not a conflict. Header-encrypted archives that cannot be listed are extracted anyway, and the extract exit code reports a bad password. `7z t` is not run first; it would read the archive twice.

A wrong password still makes 7-Zip create a 0-byte output (and `-aoa` truncates a file that is already there). The task parks files it is about to overwrite, and on a fatal exit it deletes anything that attempt created and moves the parked files back.

## Progress and exit codes

`-bsp2` writes progress to stderr. On 7-Zip 25.01 that stream is not line-oriented: the percentage is rewritten in place with backspace (`\x08`). The reader applies backspaces and takes the last `NNN%`. Until a percentage arrives, the task progress is `indeterminate` and the task row shows a moving wash instead of `0%`. Success still depends on the exit code.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Warning. The output is kept and the task is partial, with the first stderr line as the message |
| 2 | Fatal. `Wrong password` in the output is a password error; anything else is a failure (corrupt archive, disk error, …) |
| 7 | The command was rejected |
| 8 | Out of memory |
| 255 | 7-Zip stopped itself |

If the task context is cancelled, the outcome is cancelled regardless of the exit code. Stderr is read on its own goroutine so a full pipe cannot stall 7-Zip.

## Menu

The selection context menu has one **7-Zip** item between Download and Cut. **Compress...** and **Extract...** are its children. Extract is disabled unless every selected file's extension is in `archiveExtractExtensions`.

Compress suggests `name` for one file (`winmine.exe` becomes `winmine`; the format extension is added on confirm) and `folder-YYYYMMDDHHmm` for several, using the current folder name. The name field is focused and selected, and it does not show the extension. **Compress separately** writes one archive per selected item, prepending an optional prefix to each stem (`pre-` + `notes.txt` becomes `pre-notes.zip`). The dialog also picks the archive type. Each separate item is its own compress task.

Extract asks for the current folder or a subfolder named after the archive (`./filename`). Several archives each get their own folder and share one password. Opening a supported file that has no app does the same, instead of the generic unsupported-file dialog.

An encrypted archive opened without a password makes 7-Zip print its copyright banner and then `Enter password`. The task reports **Password required** rather than that banner. A wrong password is still **Wrong password**.
