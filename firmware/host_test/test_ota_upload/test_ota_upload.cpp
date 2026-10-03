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
  session.install(restart_scheduled);
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

void test_the_request_after_an_acceptance_is_not_told_accepted() {
  // The worse direction: a request that wrote nothing told it was accepted.
  UploadSession session;
  TEST_ASSERT_TRUE(accepted_upload(session, true).accepted());

  const std::optional<Answer> gated = session.gate(true);
  TEST_ASSERT_TRUE(gated.has_value());
  TEST_ASSERT_FALSE(gated->accepted());
}

void test_a_raw_body_is_answered_at_the_gate_with_a_problem_detail() {
  // Answered before the body, so it is a problem detail like every other
  // error (D-19), not PsychicUploadHandler's own 500 text/html.
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

// --- the device's own failures --------------------------------------------

void test_a_failed_write_is_the_devices_fault_not_the_files() {
  // esp_ota_begin, a flash write, esp_ota_end or the boot partition failing:
  // the image may have been fine.
  UploadSession session;
  session.gate(true);
  TEST_ASSERT_TRUE(session.begin(false));
  session.fail();
  assert_problem(rt::problem::kOtaWriteFailed, session.respond());
}

void test_a_refusal_outranks_a_failure_in_the_same_request() {
  UploadSession session;
  session.gate(true);
  session.begin(false);
  session.refuse(Refusal::kInvalidImage);
  session.fail();
  assert_problem(rt::problem::kOtaImageRefused, session.respond());
}

void test_a_failure_does_not_outlive_its_request() {
  UploadSession session;
  session.gate(true);
  session.begin(false);
  session.fail();
  session.respond();

  session.gate(true);
  assert_problem(rt::problem::kOtaImageRefused, session.respond());
}

// --- between an accepted image and the restart -----------------------------

void test_an_upload_during_the_restart_drain_is_refused_at_the_gate() {
  // The next update slot counts from the running one, so it is now the image
  // just installed: anything let through would erase it.
  UploadSession session;
  accepted_upload(session, true);
  const std::optional<Answer> gated = session.gate(true);
  TEST_ASSERT_TRUE(gated.has_value());
  assert_problem(rt::problem::kRestartPending, *gated);
  TEST_ASSERT_FALSE(session.begin(false));
}

void test_a_second_file_part_writes_nothing_and_the_request_stays_accepted() {
  UploadSession session;
  TEST_ASSERT_TRUE(accepted_upload(session, true).accepted());
  TEST_ASSERT_FALSE(session.begin(false));
  TEST_ASSERT_TRUE(session.respond().accepted());
}

void test_a_restart_is_pending_only_once_one_was_scheduled() {
  // ota::in_progress() reads this, so a program started in the drain is
  // refused rather than cut off by the restart.
  UploadSession scheduled;
  TEST_ASSERT_FALSE(scheduled.restart_pending());
  accepted_upload(scheduled, true);
  TEST_ASSERT_TRUE(scheduled.restart_pending());

  // A failed restart waits for a power cycle, which may be a long time; runs
  // are not held off for it.
  UploadSession failed;
  accepted_upload(failed, false);
  TEST_ASSERT_FALSE(failed.restart_pending());
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
  RUN_TEST(test_the_request_after_an_acceptance_is_not_told_accepted);
  RUN_TEST(test_a_raw_body_is_answered_at_the_gate_with_a_problem_detail);
  RUN_TEST(test_a_raw_body_clears_what_the_previous_upload_left);
  RUN_TEST(test_a_refusal_does_not_outlive_its_request);
  RUN_TEST(test_a_failed_write_is_the_devices_fault_not_the_files);
  RUN_TEST(test_a_refusal_outranks_a_failure_in_the_same_request);
  RUN_TEST(test_a_failure_does_not_outlive_its_request);
  RUN_TEST(test_an_upload_during_the_restart_drain_is_refused_at_the_gate);
  RUN_TEST(test_a_second_file_part_writes_nothing_and_the_request_stays_accepted);
  RUN_TEST(test_a_restart_is_pending_only_once_one_was_scheduled);
  return UNITY_END();
}
