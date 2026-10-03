import { expect, test } from '@playwright/test';

import { CONTROL_LOCK_PASSWORD, expectProblem, resetDevice } from './device';

/**
 * `POST /ota`'s refusals against the real handler (#344). The mock and
 * `host_test/test_ota_upload` drive the same table; this proves the handler is
 * wired to it - the gate runs before the body, and an empty file part, which
 * never reaches onUpload, still answers for itself.
 *
 * Nothing here is accepted: an accepted image restarts the device mid-suite.
 * `restart_failed` needs the restart task to fail to start, which nothing can
 * provoke from the outside.
 */

const API = '/api/v2';

const EMPTY_IMAGE = {
  type: '/problems/ota_image_refused',
  title: 'Firmware image refused',
  status: 400,
  detail: 'The upload was empty or too small to be a firmware image',
};

/** The image magic, and an app description at its real offset naming another project. */
function foreignImage(): Buffer {
  const image = Buffer.alloc(4096);
  image[0] = 0xe9;
  image.writeUInt32LE(0xabcd5432, 32);
  image.write('AutoLee', 80, 'latin1');
  return image;
}

function filePart(buffer: Buffer) {
  return { file: { name: 'rotation_target_backend.bin', mimeType: 'application/octet-stream', buffer } };
}

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

test.afterAll(async ({ request }) => {
  await resetDevice(request);
  // A stopped run leaves the targets where it left them, and later specs
  // expect the boot position.
  expect((await request.post(`${API}/targets/show`)).ok()).toBeTruthy();
});

test('an image for another project is refused', async ({ request }) => {
  await expectProblem(await request.post(`${API}/ota`, { multipart: filePart(foreignImage()) }), {
    type: '/problems/ota_image_refused',
    title: 'Firmware image refused',
    status: 400,
    detail: 'That firmware is for a different device - upload refused',
  });
});

test('a file that is not an image is refused on its first byte', async ({ request }) => {
  // Before #344 this answered "empty or too small": esp_ota_write refused it
  // and nothing recorded why.
  await expectProblem(await request.post(`${API}/ota`, { multipart: filePart(Buffer.alloc(4096)) }), {
    type: '/problems/ota_image_refused',
    title: 'Firmware image refused',
    status: 400,
    detail: 'That file is not a firmware image, or it is incomplete - upload refused',
  });
});

test('a running program refuses, and the next empty part answers for itself', async ({ request }) => {
  expect((await request.post(`${API}/programs/40/load`)).ok()).toBeTruthy();
  expect((await request.post(`${API}/programs/start`, { data: { id: 40 } })).ok()).toBeTruthy();

  await expectProblem(await request.post(`${API}/ota`, { multipart: filePart(foreignImage()) }), {
    type: '/problems/program_running',
    title: 'A program is running',
    status: 409,
    detail: 'A program is running - stop it before updating the firmware',
  });

  // MultipartProcessor never calls onUpload for an empty part. Before #342
  // this answered with the 409 above.
  await expectProblem(await request.post(`${API}/ota`, { multipart: filePart(Buffer.alloc(0)) }), EMPTY_IMAGE);
});

test('a raw body is answered with a problem detail', async ({ request }) => {
  // Refused from onUpload, PsychicUploadHandler answered 500 text/html itself.
  await expectProblem(
    await request.post(`${API}/ota`, {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: foreignImage(),
    }),
    {
      type: '/problems/upload_missing_file',
      title: 'No file uploaded',
      status: 400,
      detail: 'Expected a multipart/form-data body with the image in a file part',
    },
  );
});

test('is behind the control lock', async ({ playwright, request }, testInfo) => {
  expect(
    (await request.post(`${API}/control-lock/enable`, { data: { password: CONTROL_LOCK_PASSWORD } })).ok(),
  ).toBeTruthy();

  // Its own context: `enable` set the cookie on the shared one, and the device
  // accepts the cookie as a credential.
  const anonymous = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await expectProblem(await anonymous.post(`${API}/ota`, { multipart: filePart(foreignImage()) }), {
      type: '/problems/control_lock_credentials_required',
      title: 'Control lock credentials required',
      status: 401,
      detail: 'The controls are locked - log in to start or change anything',
    });
  } finally {
    await anonymous.dispose();
  }
});
