package sevenzip

import (
	"os/exec"

	"file-lite-go/utils"
)

func hideConsole(cmd *exec.Cmd) {
	utils.HideConsoleWindow(cmd)
}
