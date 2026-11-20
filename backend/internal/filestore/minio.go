package filestore

import (
	"context"
	"io"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/xinbo/xinbo-oa/internal/config"
)

// Store 包一层 MinIO：OA 只用到「放对象 / 取对象 / 删对象」三件事。
// 单独成包是为了让 api 层不直接依赖 SDK，方便以后换存储（本地卷、别的 S3）。
type Store struct {
	cli    *minio.Client
	bucket string
}

func New(cfg *config.Config) (*Store, error) {
	cli, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioUseSSL,
	})
	if err != nil {
		return nil, err
	}
	s := &Store{cli: cli, bucket: cfg.MinioBucket}
	if err = s.ensureBucket(context.Background()); err != nil {
		return nil, err
	}
	return s, nil
}

// ensureBucket 启动时建桶，避免第一次上传才报错。
func (s *Store) ensureBucket(ctx context.Context) error {
	exists, err := s.cli.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	if err = s.cli.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
		return err
	}
	log.Printf("[files] bucket created: %s", s.bucket)
	return nil
}

func (s *Store) Bucket() string { return s.bucket }

func (s *Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.cli.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (s *Store) Get(ctx context.Context, key string) (*minio.Object, error) {
	return s.cli.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
}

func (s *Store) Remove(ctx context.Context, key string) error {
	return s.cli.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}
