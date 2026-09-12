package fileops

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// BenchmarkCopySmallFiles 是小文件复制的性能基线（临时文件 + 原子改名，fsync 开启）。
//
//	go test ./fileops -bench BenchmarkCopySmallFiles -benchtime 3x -run '^$'
//
// 大量小文件的成本由「逐文件 fsync + rename」主导，改动这条路径时先跑它。
func BenchmarkCopySmallFiles(b *testing.B) {
	const fileCount = 2000
	const fileSize = 4096

	b.SetBytes(fileCount * fileSize)
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		dir := b.TempDir()
		src := filepath.Join(dir, "src")
		dst := filepath.Join(dir, "dst")
		for _, d := range []string{src, dst} {
			if err := os.MkdirAll(d, 0755); err != nil {
				b.Fatal(err)
			}
		}
		payload := make([]byte, fileSize)
		for f := 0; f < fileCount; f++ {
			if err := os.WriteFile(filepath.Join(src, fmt.Sprintf("f%05d.dat", f)), payload, 0644); err != nil {
				b.Fatal(err)
			}
		}
		engine := NewEngine(true)

		b.StartTimer()
		if _, err := engine.Run(context.Background(), Options{
			FromPaths:       []string{src},
			ToPath:          dst,
			Policy:          PolicyOverwrite,
			FileConcurrency: 4,
		}, Callbacks{}); err != nil {
			b.Fatal(err)
		}
	}
}
