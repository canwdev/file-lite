package cli

import (
	"fmt"

	"github.com/AlecAivazis/survey/v2"

	"file-lite-go/config"
)

func RunTui(getCtx func() CmdCtx, shouldContinue func() bool) error {
	cmds := Commands()
	for shouldContinue() {
		ctx := getCtx()
		options := make([]string, 0, len(cmds))
		idByLabel := make(map[string]string, len(cmds))
		for _, cmd := range cmds {
			if cmd.When != nil && !cmd.When(ctx) {
				continue
			}
			options = append(options, cmd.Label)
			idByLabel[cmd.Label] = cmd.ID
		}

		var selected string
		err := survey.AskOne(&survey.Select{
			Message: fmt.Sprintf("%s v%s Select function", config.PkgName, config.Version),
			Options: options,
		}, &selected)
		if err != nil {
			return err
		}

		id := idByLabel[selected]
		for _, cmd := range cmds {
			if cmd.ID == id {
				if err := cmd.Run(getCtx()); err != nil {
					return err
				}
				break
			}
		}
	}
	return nil
}
