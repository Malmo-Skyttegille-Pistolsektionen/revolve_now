// ============================================================================
//  What POST /api/v2/ota answers, and when (#344). test_ota_policy covers
//  whether an image may be accepted; this covers which answer a request gets,
//  driven through the callbacks in the order the handler sees them - which is
//  where #342's two defects lived, not in the policy.
// ============================================================================
#include <optional>

#include "ota_upload.h"
#include "problem.h"
#include "unity.h"

using rt::ota::Answer;
using rt::ota::Refusal;
using rt::ota::UploadSession;

void setUp() {}
void tearDown() {}

namespace {

void assert_problem(const rt::ProblemType &expected, const Answer &answer) {
  TEST_ASSERT_FALSE(answer.accepted());
  TEST_ASSERT_EQUAL_STRING(expected.slug, answer.problem->slug);
  TEST_ASSERT_EQUAL_INT(expected.status, answer.problem->status);
}

// A multipart upload that reaches the image check and passes it.
Answer accepted_upload(UploadSession &session, bool restart_scheduled) {
  TEST_ASSERT_FALSE(session.gate(true).has_value());
  TEST_ASSERT_TRUE(session.begin(false));
  session.installed(restart_scheduled);
  return session.respond();
}

}  // namespace

// --- the four answers ------------------------------------------------------

void test_an_accepted_image_answers_200_restarting() {
  UploadSession session;
  TEST_ASSERT_TRUE(accepted_upload(session, true).accepted());
}

void test_a_running_program_answers_409() {
  UploadSession session;
  TEST_ASSERT_FALSE(session.gate(true).has_value());
  TEST_ASSERT_FALSE(session.begin(true));
  const Answer answer = session.respond();
  assert_problem(rt::problem::kProgramRunning, answer);
  TEST_ASSERT_EQUAL_STRING(rt::ota::message(Refusal::kProgramRunning), answer.detail);
}

void test_a_refused_image_answers_400_with_its_reason() {
  for (const Refusal refusal :
       {Refusal::kProjectMismatch, Refusal::kEmptyImage, Refusal::kInvalidImage}) {
    UploadSession session;
    TEST_ASSERT_FALSE(session.gate(true).has_value());
    TEST_ASSERT_TRUE(session.begin(false));
    session.refuse(refusal);
    const Answer answer = session.respond();
    assert_problem(rt::problem::kOtaImageRefused, answer);
    TEST_ASSERT_EQUAL_STRING(rt::ota::message(refusal), answer.detail);
  }
}

void test_an_installed_image_that_cannot_restart_answers_500() {
  UploadSession session;
  assert_problem(rt::problem::kRestartFailed, accepted_upload(session, false));
}

// --- restart_failed is sticky ----------------------------------------------

void test_every_later_upload_is_refused_at_the_gate_until_a_power_cycle() {
  // The slot the next upload would be written to is now the boot partition,
  // so anything let through would erase the image waiting to run.
  UploadSession session;
  accepted_upload(session, false);

  for (int i = 0; i < 3; i++) {
    const std::optional<Answer> gated = session.gate(true);
    TEST_ASSERT_TRUE(gated.has_value());
    assert_problem(rt::problem::kRestartFailed, *gated);
  }
}

void test_a_raw_body_after_a_failed_restart_also_gets_restart_failed() {
  // The contract promises every further upload this answer, so it outranks
  // the complaint about the body's shape.
  UploadSession session;
  accepted_upload(session, false);
  const std::optional<Answer> gated = session.gate(false);
  TEST_ASSERT_TRUE(gated.has_value());
  assert_problem(rt::problem::kRestartFailed, *gated);
}

void test_nothing_is_written_while_awaiting_a_power_cycle_even_past_the_gate() {
  UploadSession session;
  accepted_upload(session, false);
  TEST_ASSERT_FALSE(session.begin(false));
  assert_problem(rt::problem::kRestartFailed, session.respond());
}

// --- each request answers for itself ---------------------------------------

void test_an_empty_file_part_does_not_inherit_the_previous_refusal() {
  // MultipartProcessor guards the final callback with `if (_itemSize)`, so an
  // empty or missing file part never reaches onUpload: gate, then respond.
  UploadSession session;
  session.gate(true);
  session.begin(true);
  assert_problem(rt::problem::kProgramRunning, session.respond());

  TEST_ASSERT_FALSE(session.gate(true).has_value());
  const Answer answer = session.respond();
  assert_problem(rt::problem::kOtaImageRefused, answer);
  TEST_ASSERT_EQUAL_STRING(rt::ota::message(Refusal::kEmptyImage), answer.detail);
}

void test_an_empty_file_part_does_not_inherit_the_previous_acceptance() {
  // The worse direction: a request that wrote nothing told it was accepted.
  UploadSession session;
  TEST_ASSERT_TRUE(accepted_upload(session, true).accepted());

  TEST_ASSERT_FALSE(session.gate(true).has_value());
  assert_problem(rt::problem::kOtaImageRefused, session.respond());
}

void test_a_raw_body_is_answered_at_the_gate_with_a_problem_detail() {
  // Refused by onUpload instead, PsychicUploadHandler answered 500 text/html
  // itself and onRequest never ran (D-19).
  UploadSession session;
  const std::optional<Answer> gated = session.gate(false);
  TEST_ASSERT_TRUE(gated.has_value());
  assert_problem(rt::problem::kUploadMissingFile, *gated);
}

void test_a_raw_body_clears_what_the_previous_upload_left() {
  UploadSession session;
  session.gate(true);
  session.begin(false);
  session.refuse(Refusal::kProjectMismatch);
  // No respond(): the client hung up before onRequest.

  TEST_ASSERT_TRUE(session.gate(false).has_value());
  TEST_ASSERT_FALSE(session.gate(true).has_value());
  assert_problem(rt::problem::kOtaImageRefused, session.respond());
  TEST_ASSERT_EQUAL_STRING(rt::ota::message(Refusal::kEmptyImage), session.respond().detail);
}

void test_a_refusal_does_not_outlive_its_request() {
  UploadSession session;
  session.gate(true);
  session.begin(true);
  assert_problem(rt::problem::kProgramRunning, session.respond());

  TEST_ASSERT_TRUE(accepted_upload(session, true).accepted());
}

void test_a_write_that_fails_before_the_image_check_is_refused_not_accepted() {
  // esp_ota_begin or esp_ota_write failing records nothing; the answer must
  // still be a refusal.
  UploadSession session;
  session.gate(true);
  TEST_ASSERT_TRUE(session.begin(false));
  assert_problem(rt::problem::kOtaImageRefused, session.respond());
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_an_accepted_image_answers_200_restarting);
  RUN_TEST(test_a_running_program_answers_409);
  RUN_TEST(test_a_refused_image_answers_400_with_its_reason);
  RUN_TEST(test_an_installed_image_that_cannot_restart_answers_500);
  RUN_TEST(test_every_later_upload_is_refused_at_the_gate_until_a_power_cycle);
  RUN_TEST(test_a_raw_body_after_a_failed_restart_also_gets_restart_failed);
  RUN_TEST(test_nothing_is_written_while_awaiting_a_power_cycle_even_past_the_gate);
  RUN_TEST(test_an_empty_file_part_does_not_inherit_the_previous_refusal);
  RUN_TEST(test_an_empty_file_part_does_not_inherit_the_previous_acceptance);
  RUN_TEST(test_a_raw_body_is_answered_at_the_gate_with_a_problem_detail);
  RUN_TEST(test_a_raw_body_clears_what_the_previous_upload_left);
  RUN_TEST(test_a_refusal_does_not_outlive_its_request);
  RUN_TEST(test_a_write_that_fails_before_the_image_check_is_refused_not_accepted);
  return UNITY_END();
}
