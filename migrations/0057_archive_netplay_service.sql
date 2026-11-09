-- NULL means the packaged EasyRPG.ini does not declare netplay.
ALTER TABLE archive_versions ADD COLUMN netplay_service INTEGER
  CHECK (netplay_service IN (0, 1));
