package config

import "testing"

func TestSeedEmployeesRequiresExplicitTestOptIn(t *testing.T) {
	for _, tc := range []struct {
		name, environment, optIn string
		want                     bool
	}{
		{"default", "", "", false},
		{"test only", "test", "", false},
		{"opt in outside test", "production", "true", false},
		{"explicit test opt in", "test", "true", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("OA_ENVIRONMENT", tc.environment)
			t.Setenv("OA_SEED_EMPLOYEES", tc.optIn)
			if got := Load().SeedEmployees; got != tc.want {
				t.Fatalf("SeedEmployees = %t, want %t", got, tc.want)
			}
		})
	}
}
