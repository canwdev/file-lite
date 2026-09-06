package utils

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func addEmptyDir(z *zip.Writer, name string) error {
	_, err := z.Create(name + "/")
	return err
}

// zipPath 递归把 path 写入 zip。条目在压缩过程中被删除/移走时静默跳过
// （没有内容可打包）；其它读写错误（如文件被占用、不可读）向上传播。
func zipPath(z *zip.Writer, base string, path string) error {
	st, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	name := filepath.Join(base, filepath.Base(path))
	if st.IsDir() {
		entries, err := os.ReadDir(path)
		if err != nil {
			return err
		}
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
		return err
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

// verifyZipPathReadable 递归确认 path 可读取。条目不存在时返回 nil
// （与压缩时静默跳过的行为一致）；被占用/无权限等错误原样返回。
func verifyZipPathReadable(p string) error {
	st, err := os.Stat(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !st.IsDir() {
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		return f.Close()
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := verifyZipPathReadable(filepath.Join(p, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// VerifyZipPathsReadable 在写响应头之前预检所有待压缩路径，
// 确保不会出现「响应 200 但压缩包里静默缺文件」的情况。
func VerifyZipPathsReadable(paths []string) error {
	for _, p := range paths {
		if err := verifyZipPathReadable(p); err != nil {
			return fmt.Errorf("unable to read %s: %w", p, err)
		}
	}
	return nil
}
