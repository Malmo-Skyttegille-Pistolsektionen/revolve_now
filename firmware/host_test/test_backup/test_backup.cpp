// ============================================================================
//  Backup and restore (#520): the archive's documents, the hardware overrides,
//  and RestoreSession driven over a fake device.
//
//  The session is where the restore's decisions live - what is refused as a
//  whole, what is skipped as already here, how clips are renumbered under the
//  programs that play them - so it is tested end to end from archive bytes,
//  through the same ZipWriter the backup route uses.
// ============================================================================
#include <ArduinoJson.h>

#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "backup.h"
#include "hardware_json.h"
#include "unity.h"
#include "zip_writer.h"

using rt::HardwareConfig;
using rt::backup::ItemOutcome;
using rt::backup::RestoreOptions;
using rt::backup::RestoreSession;

namespace {

// --- archive building ------------------------------------------------------

std::vector<uint8_t> g_archive;

bool collect(void *, const uint8_t *data, size_t len) {
  g_archive.insert(g_archive.end(), data, data + len);
  return true;
}

using Entries = std::vector<std::pair<std::string, std::string>>;

std::vector<uint8_t> archive(const Entries &entries) {
  g_archive.clear();
  rt::ZipWriter zip(collect, nullptr);
  for (const auto &[name, body] : entries) {
    const auto *bytes = reinterpret_cast<const uint8_t *>(body.data());
    zip.begin(name, static_cast<uint32_t>(body.size()), rt::crc32(0, bytes, body.size()));
    zip.write(bytes, body.size());
  }
  zip.finish();
  return g_archive;
}

// backup.json. `hardware` is the overrides document, empty for none.
std::string backup_doc(const std::string &hardware = "",
                       const std::map<int32_t, std::string> &titles = {}, int32_t version = 1) {
  rt::backup::Manifest m;
  m.format_version = version;
  m.firmware_version = "0.1.0";
  m.hostname = "range-a";
  m.display_name = "Bana A";
  m.hardware = hardware;
  m.audio_titles = titles;
  return rt::backup::backup_json(m);
}

std::string program_doc(const std::string &title, const std::string &audio_ids) {
  return "{\"id\":1000,\"title\":\"" + title +
         "\",\"description\":\"\",\"series\":[{\"name\":\"S\",\"events\":[{\"duration\":"
         "1000,\"command\":\"show\",\"audio_ids\":" +
         audio_ids + "}]}]}";
}

// --- the fake device -------------------------------------------------------

HardwareConfig good_defaults() {
  HardwareConfig config;
  config.banks.assign(1, rt::TargetBank{});
  config.banks[0].gpio = 5;
  config.hostname = "revolve-now";
  config.display_name = "";
  config.led_gpio = 48;
  config.i2s_bck_gpio = 10;
  config.i2s_ws_gpio = 12;
  config.i2s_dout_gpio = 11;
  config.eth_sclk_gpio = 41;
  config.eth_mosi_gpio = 39;
  config.eth_miso_gpio = 40;
  config.eth_cs_gpio = 42;
  config.eth_int_gpio = 38;
  return config;
}

class FakeStore : public rt::backup::RestoreStore {
 public:
  struct Clip {
    std::string title;
    std::string bytes;
  };
  std::map<int32_t, Clip> clips;
  std::map<int32_t, rt::Program> programs;
  std::string staged;
  bool staging = false;
  int discards = 0;
  bool window = true;
  HardwareConfig defaults = good_defaults();
  HardwareConfig saved = good_defaults();
  int saves = 0;

  bool audio_open() override {
    staged.clear();
    staging = true;
    return true;
  }
  bool audio_write(const uint8_t *data, size_t len) override {
    staged.append(reinterpret_cast<const char *>(data), len);
    return true;
  }
  ItemOutcome audio_commit(const std::string &title) override {
    staging = false;
    // Stands in for probe_wav.
    if (staged.rfind("RIFF", 0) != 0) {
      return ItemOutcome::refused(rt::problem::kAudioFormatUnsupported, "not a wav");
    }
    for (const auto &[id, clip] : clips) {
      if (clip.title == title && clip.bytes == staged) return ItemOutcome::skipped(id);
    }
    const int32_t id = next_id(clips);
    clips[id] = {title, staged};
    return ItemOutcome::added(id);
  }
  void audio_discard() override {
    staging = false;
    discards++;
  }
  ItemOutcome program_add(const rt::Program &program) override {
    for (const auto &[id, existing] : programs) {
      if (rt::backup::same_program_content(existing, program)) return ItemOutcome::skipped(id);
    }
    const int32_t id = next_id(programs);
    programs[id] = program;
    programs[id].id = id;
    return ItemOutcome::added(id);
  }
  bool config_window_open() override { return window; }
  HardwareConfig hardware_saved() override { return saved; }
  HardwareConfig hardware_defaults() override { return defaults; }
  rt::ConfigRefusal hardware_save(const HardwareConfig &config,
                                  rt::ValidationDetail *detail) override {
    const rt::ConfigRefusal refusal = rt::validate(config, {}, detail);
    if (refusal == rt::ConfigRefusal::kNone) {
      saved = config;
      saves++;
    }
    return refusal;
  }

 private:
  template <typename Map>
  static int32_t next_id(const Map &map) {
    int32_t id = 1000;
    while (map.count(id) > 0) id++;
    return id;
  }
};

const std::string kWav = std::string("RIFF") + std::string(60, '\x01');
const std::string kOtherWav = std::string("RIFF") + std::string(60, '\x02');

JsonDocument run(FakeStore &store, const Entries &entries, RestoreOptions options = {},
                 size_t chunk = 7) {
  const std::vector<uint8_t> bytes = archive(entries);
  RestoreSession session(store, options);
  for (size_t at = 0; at < bytes.size(); at += chunk) {
    session.feed(bytes.data() + at, std::min(chunk, bytes.size() - at));
  }
  session.finish();
  TEST_ASSERT_NULL_MESSAGE(session.fatal(), session.fatal_detail().c_str());
  JsonDocument doc;
  TEST_ASSERT_TRUE(deserializeJson(doc, session.report_json()) == DeserializationError::Ok);
  return doc;
}

}  // namespace

void setUp() {}
void tearDown() {}

// --- documents -------------------------------------------------------------

void test_backup_json_round_trips() {
  rt::backup::Manifest out;
  std::string error;
  const std::string doc = backup_doc("{\"i2sMclkGpio\":3}", {{1000, "Ladda"}, {1002, "Eld"}});
  TEST_ASSERT_TRUE(rt::backup::parse_backup(doc, out, error));
  TEST_ASSERT_EQUAL_STRING("0.1.0", out.firmware_version.c_str());
  TEST_ASSERT_EQUAL_STRING("range-a", out.hostname.c_str());
  TEST_ASSERT_EQUAL_STRING("{\"i2sMclkGpio\":3}", out.hardware.c_str());
  TEST_ASSERT_EQUAL_size_t(2, out.audio_titles.size());
  TEST_ASSERT_EQUAL_STRING("Eld", out.audio_titles.at(1002).c_str());
  TEST_ASSERT_NOT_NULL(strstr(doc.c_str(), "\"includesWifiCredentials\":false"));
}

void test_backup_json_has_the_documented_shape() {
  JsonDocument doc;
  deserializeJson(doc, backup_doc("{}", {{1000, "Ladda"}}));
  TEST_ASSERT_EQUAL_STRING("revolve-now-backup", doc["format"]);
  TEST_ASSERT_EQUAL_INT32(1, doc["formatVersion"]);
  TEST_ASSERT_TRUE(doc["hardware"].is<JsonObject>());
  TEST_ASSERT_EQUAL_INT32(1000, doc["audios"][0]["id"]);
  TEST_ASSERT_EQUAL_STRING("Ladda", doc["audios"][0]["title"]);
}

void test_a_malformed_audio_list_costs_only_the_titles() {
  rt::backup::Manifest out;
  std::string error;
  TEST_ASSERT_TRUE(rt::backup::parse_backup(
      "{\"format\":\"revolve-now-backup\",\"formatVersion\":1,\"audios\":{\"1000\":1}}", out,
      error));
  TEST_ASSERT_TRUE(out.audio_titles.empty());
  TEST_ASSERT_TRUE(out.hardware.empty());
}

void test_backup_json_from_a_newer_format_is_refused() {
  rt::backup::Manifest out;
  std::string error;
  TEST_ASSERT_FALSE(rt::backup::parse_backup(backup_doc("", {}, 2), out, error));
  TEST_ASSERT_NOT_NULL(strstr(error.c_str(), "format 2"));
}

void test_a_document_of_another_kind_is_not_a_backup() {
  rt::backup::Manifest out;
  std::string error;
  TEST_ASSERT_FALSE(
      rt::backup::parse_backup("{\"format\":\"other\",\"formatVersion\":1}", out, error));
  TEST_ASSERT_FALSE(rt::backup::parse_backup("[]", out, error));
}

void test_entry_names_parse_only_in_their_own_directory() {
  int32_t id = 0;
  TEST_ASSERT_TRUE(rt::backup::parse_audio_entry("audio/1003.wav", id));
  TEST_ASSERT_EQUAL_INT32(1003, id);
  TEST_ASSERT_TRUE(rt::backup::parse_program_entry("programs/1001.json", id));
  TEST_ASSERT_EQUAL_INT32(1001, id);
  TEST_ASSERT_FALSE(rt::backup::parse_audio_entry("audio/1000.json", id));
  TEST_ASSERT_FALSE(rt::backup::parse_audio_entry("programs/1.wav", id));
  TEST_ASSERT_FALSE(rt::backup::parse_program_entry("programs/.json", id));
  TEST_ASSERT_FALSE(rt::backup::parse_program_entry("programs/../1.json", id));
}

void test_the_download_name_starts_with_the_product() {
  TEST_ASSERT_EQUAL_STRING(
      "revolve-now-backup-0.1.0.zip",
      rt::backup::download_name("revolve-now", "revolve-now", "0.1.0").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "revolve-now-backup-bana-3-0.1.0-2-gabc.zip",
      rt::backup::download_name("bana-3", "revolve-now", "0.1.0-2-gabc").c_str());
  TEST_ASSERT_EQUAL_STRING("revolve-now-backup-a-b-1.0.zip",
                           rt::backup::download_name("a b", "revolve-now", "1.0").c_str());
}

void test_remap_rewrites_uploaded_ids_keeps_shipped_and_drops_unknown() {
  rt::Program program;
  rt::Event event{1000, "show", {3, 1000, 1001, 1001}};
  program.series.push_back({"S", false, {event}, 0});
  const std::vector<int32_t> dropped = rt::backup::remap_audio_ids(program, {{1000, 1005}}, 1000);
  const std::vector<int32_t> expected{3, 1005};
  TEST_ASSERT_TRUE(program.series[0].events[0].audio_ids == expected);
  TEST_ASSERT_EQUAL_size_t(1, dropped.size());
  TEST_ASSERT_EQUAL_INT32(1001, dropped[0]);
}

void test_programs_differing_only_in_id_are_the_same_content() {
  rt::Program a;
  a.id = 1000;
  a.title = "P";
  rt::Program b = a;
  b.id = 1004;
  b.readonly = true;
  TEST_ASSERT_TRUE(rt::backup::same_program_content(a, b));
  b.title = "Q";
  TEST_ASSERT_FALSE(rt::backup::same_program_content(a, b));
}

// --- hardware JSON ---------------------------------------------------------

void test_overrides_carry_only_what_differs_and_never_boot_targets() {
  const HardwareConfig defaults = good_defaults();
  HardwareConfig saved = defaults;
  TEST_ASSERT_EQUAL_STRING("{}", rt::hardware_overrides_json(saved, defaults).c_str());

  saved.i2s_mclk_gpio = 3;
  saved.banks[0].name = "Left";
  saved.targets_shown_at_boot = !defaults.targets_shown_at_boot;
  const std::string json = rt::hardware_overrides_json(saved, defaults);
  TEST_ASSERT_EQUAL_STRING(
      "{\"banks\":[{\"gpio\":5,\"activeLow\":true,\"name\":\"Left\"}],\"i2sMclkGpio\":3}",
      json.c_str());
}

void test_overrides_applied_to_defaults_reproduce_the_saved_config() {
  const HardwareConfig defaults = good_defaults();
  HardwareConfig saved = defaults;
  saved.hostname = "range-b";
  saved.http_port = 8080;
  saved.wifi_enabled = false;
  saved.banks.push_back({6, false, "B"});

  HardwareConfig restored = defaults;
  TEST_ASSERT_EQUAL(
      rt::PatchError::kNone,
      rt::apply_hardware_patch(rt::hardware_overrides_json(saved, defaults), restored));
  TEST_ASSERT_TRUE(rt::same_config(saved, restored));
  TEST_ASSERT_TRUE(saved.banks == restored.banks);
}

void test_a_patch_naming_boot_targets_is_serial_only() {
  HardwareConfig config = good_defaults();
  TEST_ASSERT_EQUAL(rt::PatchError::kSerialOnly,
                    rt::apply_hardware_patch("{\"targetsShownAtBoot\":true}", config));
  TEST_ASSERT_EQUAL(rt::PatchError::kNotObject, rt::apply_hardware_patch("[1]", config));
  TEST_ASSERT_EQUAL(rt::PatchError::kBanksNotArray,
                    rt::apply_hardware_patch("{\"banks\":5}", config));
  TEST_ASSERT_EQUAL(rt::PatchError::kBankNotObject,
                    rt::apply_hardware_patch("{\"banks\":[5]}", config));
}

// --- RestoreSession --------------------------------------------------------

void test_a_full_restore_adds_everything_and_renumbers_clips_under_programs() {
  FakeStore store;
  // An upload already on this device, so restored clips cannot keep their ids.
  store.clips[1000] = {"Existing", kOtherWav};

  JsonDocument report =
      run(store, {{"backup.json", backup_doc("{\"i2sMclkGpio\":3}", {{1000, "Ladda"}})},
                  {"audio/1000.wav", kWav},
                  {"programs/1000.json", program_doc("P", "[2,1000]")}});

  TEST_ASSERT_EQUAL_STRING("0.1.0", report["source"]["firmwareVersion"]);
  TEST_ASSERT_EQUAL_STRING("saved", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL_INT32(3, store.saved.i2s_mclk_gpio);

  TEST_ASSERT_EQUAL_STRING("added", report["audios"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING("Ladda", report["audios"][0]["title"]);
  TEST_ASSERT_EQUAL_INT32(1000, report["audios"][0]["sourceId"]);
  TEST_ASSERT_EQUAL_INT32(1001, report["audios"][0]["id"]);

  TEST_ASSERT_EQUAL_STRING("added", report["programs"][0]["result"]);
  const rt::Program &restored = store.programs.at(report["programs"][0]["id"].as<int32_t>());
  const std::vector<int32_t> expected{2, 1001};
  TEST_ASSERT_TRUE(restored.series[0].events[0].audio_ids == expected);
  TEST_ASSERT_TRUE(report["stoppedEarly"].isNull());
}

void test_restoring_twice_skips_what_is_already_here() {
  FakeStore store;
  const Entries entries = {{"backup.json", backup_doc("", {{1000, "Ladda"}})},
                           {"audio/1000.wav", kWav},
                           {"programs/1000.json", program_doc("P", "[1000]")}};
  run(store, entries);
  JsonDocument second = run(store, entries);

  TEST_ASSERT_EQUAL_STRING("skipped", second["audios"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING("skipped", second["programs"][0]["result"]);
  TEST_ASSERT_EQUAL_size_t(1, store.clips.size());
  TEST_ASSERT_EQUAL_size_t(1, store.programs.size());
}

void test_a_clip_with_the_same_title_but_other_bytes_is_added() {
  FakeStore store;
  store.clips[1000] = {"Ladda", kOtherWav};
  JsonDocument report =
      run(store, {{"backup.json", backup_doc("", {{1000, "Ladda"}})}, {"audio/1000.wav", kWav}});
  TEST_ASSERT_EQUAL_STRING("added", report["audios"][0]["result"]);
}

void test_a_refused_clip_is_reported_and_its_references_dropped() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc()},
                                    {"audio/1000.wav", "not a wav"},
                                    {"programs/1000.json", program_doc("P", "[1000]")}});

  TEST_ASSERT_EQUAL_STRING("refused", report["audios"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING("/problems/audio_format_unsupported",
                           report["audios"][0]["problem"]["type"]);
  TEST_ASSERT_EQUAL_STRING("Restored clip 1000", report["audios"][0]["title"]);
  TEST_ASSERT_EQUAL_STRING("added", report["programs"][0]["result"]);
  TEST_ASSERT_EQUAL_INT32(1000, report["programs"][0]["droppedAudioIds"][0]);
}

void test_an_unreadable_program_is_refused_and_the_rest_carry_on() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc()},
                                    {"programs/1000.json", "{not json"},
                                    {"programs/1001.json", program_doc("Q", "[]")}});
  TEST_ASSERT_EQUAL_STRING("refused", report["programs"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING("/problems/program_invalid", report["programs"][0]["problem"]["type"]);
  TEST_ASSERT_EQUAL_STRING("added", report["programs"][1]["result"]);
}

void test_hardware_waits_for_the_configuration_window() {
  FakeStore store;
  store.window = false;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{\"i2sMclkGpio\":3}")}});
  TEST_ASSERT_EQUAL_STRING("skipped", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL_STRING("/problems/hardware_config_window_closed",
                           report["hardware"]["problem"]["type"]);
  TEST_ASSERT_EQUAL(0, store.saves);
}

void test_hardware_already_in_place_needs_no_window() {
  FakeStore store;
  store.window = false;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{}")}});
  TEST_ASSERT_EQUAL_STRING("unchanged", report["hardware"]["result"]);
  TEST_ASSERT_TRUE(report["hardware"]["problem"].isNull());
  TEST_ASSERT_EQUAL(0, store.saves);
}

void test_a_long_clip_list_is_not_refused() {
  FakeStore store;
  std::map<int32_t, std::string> titles;
  for (int32_t id = 1000; id < 3000; ++id) titles[id] = std::string(60, 'x');
  const std::string doc = backup_doc("", titles);
  TEST_ASSERT_GREATER_THAN(64 * 1024, doc.size());
  JsonDocument report = run(store, {{"backup.json", doc}, {"audio/2999.wav", kWav}});
  TEST_ASSERT_EQUAL_STRING("added", report["audios"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING(std::string(60, 'x').c_str(), report["audios"][0]["title"]);
}

void test_hardware_can_be_left_out() {
  FakeStore store;
  RestoreOptions options;
  options.hardware = false;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{\"i2sMclkGpio\":3}")}}, options);
  TEST_ASSERT_EQUAL_STRING("notRequested", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL(0, store.saves);
}

void test_the_name_is_kept_unless_asked_for() {
  FakeStore store;
  store.saved.hostname = "this-board";
  const Entries entries = {
      {"backup.json", backup_doc("{\"hostname\":\"range-a\",\"ledGpio\":47}")}};

  run(store, entries);
  TEST_ASSERT_EQUAL_STRING("this-board", store.saved.hostname.c_str());
  TEST_ASSERT_EQUAL_INT32(47, store.saved.led_gpio);

  RestoreOptions options;
  options.name = true;
  run(store, entries, options);
  TEST_ASSERT_EQUAL_STRING("range-a", store.saved.hostname.c_str());
}

void test_hardware_restores_onto_defaults_not_onto_what_is_saved() {
  FakeStore store;
  store.saved.http_port = 8080;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{}")}});
  TEST_ASSERT_EQUAL_STRING("saved", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL_INT32(80, store.saved.http_port);
}

void test_boot_targets_survive_a_restore() {
  FakeStore store;
  store.saved.targets_shown_at_boot = false;
  run(store, {{"backup.json", backup_doc("{\"ledGpio\":47}")}});
  TEST_ASSERT_FALSE(store.saved.targets_shown_at_boot);
}

void test_hardware_identical_to_what_is_saved_is_unchanged() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{}")}});
  TEST_ASSERT_EQUAL_STRING("unchanged", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL(0, store.saves);
}

void test_hardware_the_device_refuses_is_reported_with_its_reason() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc("{\"ledGpio\":27}")}});
  TEST_ASSERT_EQUAL_STRING("refused", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL_STRING("/problems/hardware_config_invalid",
                           report["hardware"]["problem"]["type"]);
}

void test_hardware_that_is_not_an_object_is_refused_and_the_rest_carry_on() {
  FakeStore store;
  JsonDocument report = run(
      store, {{"backup.json", backup_doc("[1]")}, {"programs/1000.json", program_doc("P", "[]")}});
  TEST_ASSERT_EQUAL_STRING("refused", report["hardware"]["result"]);
  TEST_ASSERT_EQUAL_STRING("added", report["programs"][0]["result"]);
  TEST_ASSERT_EQUAL(0, store.saves);
}

void test_an_archive_without_hardware_says_so() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc()}});
  TEST_ASSERT_EQUAL_STRING("notIncluded", report["hardware"]["result"]);
}

void test_unknown_entries_are_passed_over() {
  FakeStore store;
  JsonDocument report = run(store, {{"backup.json", backup_doc()},
                                    {"future/thing.bin", "xyz"},
                                    {"programs/1000.json", program_doc("P", "[]")}});
  TEST_ASSERT_EQUAL_STRING("added", report["programs"][0]["result"]);
}

// --- refused as a whole -----------------------------------------------------

const rt::ProblemType *fatal_of(const std::vector<uint8_t> &bytes, FakeStore &store) {
  RestoreSession session(store, {});
  session.feed(bytes.data(), bytes.size());
  session.finish();
  return session.fatal();
}

void test_a_file_that_is_not_a_zip_is_refused_whole() {
  FakeStore store;
  const std::string text = "hello";
  const std::vector<uint8_t> bytes(text.begin(), text.end());
  TEST_ASSERT_EQUAL_PTR(&rt::problem::kBackupInvalid, fatal_of(bytes, store));
}

void test_an_empty_body_is_refused_whole() {
  FakeStore store;
  TEST_ASSERT_EQUAL_PTR(&rt::problem::kBackupInvalid, fatal_of({}, store));
}

void test_a_zip_not_starting_with_backup_json_is_refused_before_anything_applies() {
  FakeStore store;
  const std::vector<uint8_t> bytes =
      archive({{"programs/1000.json", program_doc("P", "[]")}, {"backup.json", backup_doc()}});
  TEST_ASSERT_EQUAL_PTR(&rt::problem::kBackupInvalid, fatal_of(bytes, store));
  TEST_ASSERT_EQUAL_size_t(0, store.programs.size());
}

void test_a_backup_from_before_backup_json_says_so() {
  FakeStore store;
  RestoreSession session(store, {});
  const std::vector<uint8_t> bytes =
      archive({{"manifest.json", "{\"format\":\"revolve-now-backup\",\"formatVersion\":1}"}});
  session.feed(bytes.data(), bytes.size());
  session.finish();
  TEST_ASSERT_EQUAL_PTR(&rt::problem::kBackupInvalid, session.fatal());
  TEST_ASSERT_NOT_NULL(strstr(session.fatal_detail().c_str(), "development build"));
}

void test_a_newer_format_is_refused_whole() {
  FakeStore store;
  RestoreSession session(store, {});
  const std::vector<uint8_t> bytes = archive({{"backup.json", backup_doc("", {}, 9)}});
  session.feed(bytes.data(), bytes.size());
  session.finish();
  TEST_ASSERT_EQUAL_PTR(&rt::problem::kBackupInvalid, session.fatal());
  TEST_ASSERT_NOT_NULL(strstr(session.fatal_detail().c_str(), "format 9"));
}

// --- stopped part way -------------------------------------------------------

void test_a_truncated_backup_reports_what_it_restored() {
  FakeStore store;
  std::vector<uint8_t> bytes = archive({{"backup.json", backup_doc()},
                                        {"programs/1000.json", program_doc("P", "[]")},
                                        {"audio/1000.wav", kWav}});
  // Cut inside the clip: the program before it is restored, the clip is not.
  bytes.resize(bytes.size() - 22 - 3 * 46 - 50);

  RestoreSession session(store, {});
  session.feed(bytes.data(), bytes.size());
  session.finish();
  TEST_ASSERT_NULL(session.fatal());
  JsonDocument report;
  deserializeJson(report, session.report_json());
  TEST_ASSERT_EQUAL_STRING("added", report["programs"][0]["result"]);
  TEST_ASSERT_EQUAL_size_t(0, report["audios"].size());
  TEST_ASSERT_EQUAL_STRING("/problems/backup_invalid", report["stoppedEarly"]["type"]);
  TEST_ASSERT_EQUAL(1, store.discards);
  TEST_ASSERT_FALSE(store.staging);
}

void test_a_damaged_clip_is_refused_and_discarded() {
  FakeStore store;
  std::vector<uint8_t> bytes = archive({{"backup.json", backup_doc()}, {"audio/1000.wav", kWav}});
  // The clip's payload starts after the backup.json entry and its own header.
  const size_t clip =
      30 + strlen("backup.json") + backup_doc().size() + 30 + strlen("audio/1000.wav");
  bytes[clip + 10] ^= 0xFF;

  RestoreSession session(store, {});
  session.feed(bytes.data(), bytes.size());
  session.finish();
  JsonDocument report;
  deserializeJson(report, session.report_json());
  TEST_ASSERT_EQUAL_STRING("refused", report["audios"][0]["result"]);
  TEST_ASSERT_EQUAL_STRING("/problems/backup_invalid", report["audios"][0]["problem"]["type"]);
  TEST_ASSERT_EQUAL_size_t(0, store.clips.size());
  TEST_ASSERT_EQUAL(1, store.discards);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_backup_json_round_trips);
  RUN_TEST(test_backup_json_has_the_documented_shape);
  RUN_TEST(test_a_malformed_audio_list_costs_only_the_titles);
  RUN_TEST(test_backup_json_from_a_newer_format_is_refused);
  RUN_TEST(test_a_document_of_another_kind_is_not_a_backup);
  RUN_TEST(test_entry_names_parse_only_in_their_own_directory);
  RUN_TEST(test_the_download_name_starts_with_the_product);
  RUN_TEST(test_remap_rewrites_uploaded_ids_keeps_shipped_and_drops_unknown);
  RUN_TEST(test_programs_differing_only_in_id_are_the_same_content);
  RUN_TEST(test_overrides_carry_only_what_differs_and_never_boot_targets);
  RUN_TEST(test_overrides_applied_to_defaults_reproduce_the_saved_config);
  RUN_TEST(test_a_patch_naming_boot_targets_is_serial_only);
  RUN_TEST(test_a_full_restore_adds_everything_and_renumbers_clips_under_programs);
  RUN_TEST(test_restoring_twice_skips_what_is_already_here);
  RUN_TEST(test_a_clip_with_the_same_title_but_other_bytes_is_added);
  RUN_TEST(test_a_refused_clip_is_reported_and_its_references_dropped);
  RUN_TEST(test_an_unreadable_program_is_refused_and_the_rest_carry_on);
  RUN_TEST(test_hardware_waits_for_the_configuration_window);
  RUN_TEST(test_hardware_already_in_place_needs_no_window);
  RUN_TEST(test_a_long_clip_list_is_not_refused);
  RUN_TEST(test_hardware_can_be_left_out);
  RUN_TEST(test_the_name_is_kept_unless_asked_for);
  RUN_TEST(test_hardware_restores_onto_defaults_not_onto_what_is_saved);
  RUN_TEST(test_boot_targets_survive_a_restore);
  RUN_TEST(test_hardware_identical_to_what_is_saved_is_unchanged);
  RUN_TEST(test_hardware_the_device_refuses_is_reported_with_its_reason);
  RUN_TEST(test_hardware_that_is_not_an_object_is_refused_and_the_rest_carry_on);
  RUN_TEST(test_an_archive_without_hardware_says_so);
  RUN_TEST(test_unknown_entries_are_passed_over);
  RUN_TEST(test_a_file_that_is_not_a_zip_is_refused_whole);
  RUN_TEST(test_an_empty_body_is_refused_whole);
  RUN_TEST(test_a_zip_not_starting_with_backup_json_is_refused_before_anything_applies);
  RUN_TEST(test_a_backup_from_before_backup_json_says_so);
  RUN_TEST(test_a_newer_format_is_refused_whole);
  RUN_TEST(test_a_truncated_backup_reports_what_it_restored);
  RUN_TEST(test_a_damaged_clip_is_refused_and_discarded);
  return UNITY_END();
}
