package utils

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
)

func addEmptyDir(z *zip.Writer, name string) error {
	_, err := z.Create(name + "/")
	return err
}

func zipPath(z *zip.Writer, base string, path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return nil
	}
	name := filepath.Join(base, filepath.Base(path))
	if st.IsDir() {
		entries, _ := os.ReadDir(path)
		if len(entries) == 0 {
			return addEmptyDir(z, name)
		}
		for _, e := range entries {
			if err := zipPath(z, name, filepath.Join(path, e.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	w, err := z.Create(filepath.ToSlash(name))
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}

func ZipPathsToWriter(paths []string, w io.Writer) error {
	z := zip.NewWriter(w)
	for _, p := range paths {
		if err := zipPath(z, "", p); err != nil {
			return err
		}
	}
	return z.Close()
}
