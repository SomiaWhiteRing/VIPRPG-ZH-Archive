CREATE TABLE user_interaction_restrictions (
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN('like','reply','mention','message','friend')),
  PRIMARY KEY(recipient_user_id,sender_user_id,kind),
  CHECK(recipient_user_id<>sender_user_id)
);
