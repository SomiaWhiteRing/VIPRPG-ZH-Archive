-- Download names are mutable presentation settings; uploaded file identities stay immutable.
ALTER TABLE resources ADD COLUMN download_filename_template TEXT NOT NULL DEFAULT ''
  CHECK(length(download_filename_template) <= 180);
