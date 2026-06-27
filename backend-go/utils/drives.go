package utils

import (
	"file-lite-go/types"
	"encoding/json"
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sort"
)
// 用于解析 PowerShell 返回的单条 JSON 数据结构
type psVolume struct {
	DriveLetter     string `json:"DriveLetter"`
	FileSystemLabel string `json:"FileSystemLabel"`
	Size            *int64 `json:"Size"`
	SizeRemaining   *int64 `json:"SizeRemaining"`
}

// 修改后的 GetWindowsDrives 升级版：优先使用 PowerShell，失败则回退
func GetWindowsDrives() []types.Drive {
	if runtime.GOOS != "windows" {
		return []types.Drive{}
	}

	// 1. 尝试使用 PowerShell 获取丰富信息
	if list, err := getDrivesViaPowerShell(); err == nil && len(list) > 0 {
		return list
	}

	// 2. 如果 PowerShell 失败或不支持，回退到原有的 fsutil 方法
	return getDrivesViaFsutilFallback()
}

// 核心方法：通过 PowerShell 获取并解析 JSON
func getDrivesViaPowerShell() ([]types.Drive, error) {
	cmd := exec.Command("powershell", "-Command", `Get-Volume | Select-Object DriveLetter, FileSystemLabel, Size, SizeRemaining | ConvertTo-Json`)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var psVolumes []psVolume
	if err := json.Unmarshal(out, &psVolumes); err != nil {
		var singleVol psVolume
		if errSingle := json.Unmarshal(out, &singleVol); errSingle == nil {
			psVolumes = append(psVolumes, singleVol)
		} else {
			return nil, err
		}
	}

	var list []types.Drive
	for _, vol := range psVolumes {
		letter := strings.TrimSpace(vol.DriveLetter)
		if letter == "" {
			continue // 先去掉空盘符
		}

		path := letter + `:\`
		
		// 盘符不为空但 label 为空，使用 Local Disk 填充
		labelName := strings.TrimSpace(vol.FileSystemLabel)
		if labelName == "" {
			labelName = "Local Disk"
		}
		label := fmt.Sprintf("%s (%s:)", labelName, letter)

		list = append(list, types.Drive{Label: label, Path: path, Free: vol.SizeRemaining, Total: vol.Size})
	}

	// 严格按盘符顺序排序 (C, D, E...)
	sort.Slice(list, func(i, j int) bool {
		return list[i].Path < list[j].Path
	})

	return list, nil
}

// 回退方法：原 fsutil 逻辑
func getDrivesViaFsutilFallback() []types.Drive {
	cmd := exec.Command("fsutil", "fsinfo", "drives")
	out, err := cmd.Output() 
	if err != nil {
		return []types.Drive{}
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 {
		return []types.Drive{}
	}
	l := lines[len(lines)-1]
	parts := strings.Fields(l)
	
	var list []types.Drive
	for _, p := range parts {
		if strings.HasSuffix(p, `:\`) || strings.HasSuffix(p, `:/`) {
			d := strings.TrimSuffix(p, `\`)
			d = strings.TrimSuffix(d, `/`) // 得到类似 "C:"
			
			// 提取盘符字母
			letter := strings.TrimSuffix(d, ":")
			list = append(list, types.Drive{
				Label: fmt.Sprintf("%s:", letter), // 回退模式下没有卷标，显示 (C:)
				Path:  d + `\` ,
				Free:  nil,
				Total: nil,
			})
		}
	}
	return list
}

func GetUnixMounts() []string {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return []string{"/"}
	}
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
	if len(mounts) == 0 {
		mounts = []string{"/"}
	}
	return mounts
}
