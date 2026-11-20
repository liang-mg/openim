package main

import (
	"context"
	"log"
	"time"

	"github.com/xinbo/xinbo-oa/internal/api"
	"github.com/xinbo/xinbo-oa/internal/config"
	"github.com/xinbo/xinbo-oa/internal/filestore"
	"github.com/xinbo/xinbo-oa/internal/store"
)

func main() {
	cfg := config.Load()

	st, err := store.Connect(cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo connect failed: %v", err)
	}

	// 文件存储连不上不致命：打卡和日报的正文仍可用，只是附件传不了。
	// 但要在日志里明确报出来，避免上线后才发现附件一直失败。
	files, ferr := filestore.New(cfg)
	if ferr != nil {
		log.Printf("[files] minio init failed (attachments disabled): %v", ferr)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err = st.EnsureIndexes(ctx); err != nil {
		log.Fatalf("ensure indexes failed: %v", err)
	}
	if err = st.SeedEmployees(ctx, cfg.CompanyID); err != nil {
		log.Printf("seed employees failed (non-fatal): %v", err)
	}

	srv := api.NewServer(st, cfg, files)
	log.Printf("xinbo-oa listening on :%s (company=%s, db=%s)", cfg.Port, cfg.CompanyID, cfg.MongoDB)
	if err = srv.Router().Run(":" + cfg.Port); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
