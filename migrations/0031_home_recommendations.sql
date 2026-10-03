CREATE TABLE home_recommendations (
  work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0)
);

CREATE INDEX idx_home_recommendations_order
  ON home_recommendations(sort_order, work_id);
