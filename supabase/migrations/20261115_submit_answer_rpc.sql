-- 1. Ensure unique constraint on (player_id, question_id) to guarantee database-level concurrency protection
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'answers_player_question_key'
  ) THEN
    ALTER TABLE answers ADD CONSTRAINT answers_player_question_key UNIQUE (player_id, question_id);
  END IF;
END $$;

-- 2. Revoke execute on public schema functions by default for anonymous users
-- Atomic function to insert an answer and increment player score
CREATE OR REPLACE FUNCTION submit_player_answer(
  p_room_id UUID,
  p_player_id UUID,
  p_question_id UUID,
  p_selected_option_index INT,
  p_is_correct BOOLEAN,
  p_points_awarded INT,
  p_response_time_ms INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_score INT;
  v_answer_id UUID;
BEGIN
  -- 1. Check if an answer for this player and question already exists
  IF EXISTS (
    SELECT 1 FROM answers
    WHERE player_id = p_player_id AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Answer already submitted for this question',
      'code', 'ALREADY_SUBMITTED'
    );
  END IF;

  -- 2. Insert answer row using clock_timestamp() for exact actual submission time
  INSERT INTO answers (
    room_id,
    player_id,
    question_id,
    submitted_at,
    selected_option_index,
    is_correct,
    points_awarded,
    response_time_ms
  )
  VALUES (
    p_room_id,
    p_player_id,
    p_question_id,
    clock_timestamp(),
    p_selected_option_index,
    p_is_correct,
    p_points_awarded,
    p_response_time_ms
  )
  RETURNING id INTO v_answer_id;

  -- 3. Atomically update player score
  UPDATE players
  SET score = score + p_points_awarded
  WHERE id = p_player_id AND room_id = p_room_id
  RETURNING score INTO v_new_score;

  RETURN jsonb_build_object(
    'success', true,
    'answer_id', v_answer_id,
    'points_awarded', p_points_awarded,
    'total_score', v_new_score,
    'submitted_at', clock_timestamp()
  );
END;
$$;

-- 3. Restrict execution permissions: ONLY service_role can call this function
REVOKE ALL ON FUNCTION submit_player_answer(UUID, UUID, UUID, INT, BOOLEAN, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_player_answer(UUID, UUID, UUID, INT, BOOLEAN, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION submit_player_answer(UUID, UUID, UUID, INT, BOOLEAN, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION submit_player_answer(UUID, UUID, UUID, INT, BOOLEAN, INT, INT) TO service_role;

