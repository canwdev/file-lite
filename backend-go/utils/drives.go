package utils

import (
    "bufio"
    "os"
    "os/exec"
    "runtime"
    "strings"
)

func GetWindowsDrives() []string {
    if runtime.GOOS != "windows" { return []string{} }
    cmd := exec.Command("fsutil", "fsinfo", "drives")
    out, err := cmd.Output()
    if err != nil { return []string{} }
    lines := strings.Split(strings.TrimSpace(string(out)), "\n")
    if len(lines) == 0 { return []string{} }
    l := lines[len(lines)-1]
    parts := strings.Fields(l)
    var drives []string
    for _, p := range parts {
        if strings.HasSuffix(p, `:\`) || strings.HasSuffix(p, `:/`) {
            d := strings.TrimSuffix(p, `\`)
            d = strings.TrimSuffix(d, `/`)
            drives = append(drives, d)
        }
    }
    return drives
}

func GetUnixMounts() []string {
    f, err := os.Open("/proc/mounts")
    if err != nil { return []string{"/"} }
    defer f.Close()
    var mounts []string
    s := bufio.NewScanner(f)
    for s.Scan() {
        parts := strings.Fields(s.Text())
        if len(parts) >= 2 {
            m := parts[1]
            if strings.HasPrefix(m, "/") {
                mounts = append(mounts, m)
            }
        }
    }
    if len(mounts) == 0 { mounts = []string{"/"} }
    return mounts
}