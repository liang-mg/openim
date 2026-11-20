package api

import "testing"

// 打卡范围判定完全依赖这个距离公式，错了就会把在公司的人判成「范围外」，
// 所以单独锁一下数值，别等上线才靠肉眼发现。
func TestHaversineMeters(t *testing.T) {
	cases := []struct {
		name                   string
		lat1, lng1, lat2, lng2 float64
		min, max               int
	}{
		{"同一点", 22.5403, 113.9345, 22.5403, 113.9345, 0, 0},
		{"同一栋楼几十米", 22.5403, 113.9345, 22.5408, 113.9347, 50, 80},
		{"深圳南山到福田约 14 公里", 22.5403, 113.9345, 22.5431, 114.0579, 12000, 13000},
		{"北京到上海约 1067 公里", 39.9042, 116.4074, 31.2304, 121.4737, 1040000, 1090000},
	}
	for _, c := range cases {
		got := haversineMeters(c.lat1, c.lng1, c.lat2, c.lng2)
		if got < c.min || got > c.max {
			t.Fatalf("%s: haversineMeters = %d, 期望 %d~%d", c.name, got, c.min, c.max)
		}
	}
}

func TestFmtDistance(t *testing.T) {
	if got := fmtDistance(320); got != "320 米" {
		t.Fatalf("fmtDistance(320) = %q", got)
	}
	if got := fmtDistance(1987); got != "2.0 公里" {
		t.Fatalf("fmtDistance(1987) = %q", got)
	}
}

// 半径边界：范围判定就是 distance <= radius，这里锁住「刚好在半径内算范围内」的语义。
func TestFenceBoundary(t *testing.T) {
	const radius = 500
	near := haversineMeters(22.5403, 113.9345, 22.5408, 113.9347) // 约 60 米
	if near > radius {
		t.Fatalf("60 米内应判范围内，实际 %d", near)
	}
	edge := haversineMeters(22.5403, 113.9345, 22.5403, 113.9390) // 约 460 米，仍在半径内
	if edge > radius || edge < 400 {
		t.Fatalf("460 米左右应算出 400~500 米，实际 %d", edge)
	}
	far := haversineMeters(22.5403, 113.9345, 22.55, 113.95) // 约 1.9 公里
	if far <= radius || far < 1500 {
		t.Fatalf("1.9 公里应判范围外，实际 %d", far)
	}
}
