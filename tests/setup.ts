process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://bereyl:bereyl@localhost:5432/bereyl_test";
process.env.STORAGE_DIR = process.env.STORAGE_DIR_TEST ?? "/tmp/bereyl-test-storage";
process.env.DEMO_MODE = "true";
delete process.env.SMTP_HOST;
