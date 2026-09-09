const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const utils = require('../embedded-annotation-utils.js');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = app.indexOf('async function readEmbeddedAnnotationState(');
const end = app.indexOf('\nasync function createNativeEditingPdf(', start);
const context = vm.createContext({window: {}, ensureAnnotationPackage: value => value});
vm.runInContext(app.slice(start, end), context);
const read = attachments => context.readEmbeddedAnnotationState({getAttachments: async () => attachments});

(async () => {
    // A failed helper download must not turn an ordinary PDF into a corrupt
    // editable PDF. PDF.js uses null when the document has no attachments.
    assert.equal(await read(null), null);
    assert.equal(await read({}), null);

    const payload = {format: 'draftannotator.annotations', version: 1, pages: []};
    const attachments = {state: {
        filename: utils.NATIVE_ANNOTATIONS_NAME,
        content: new TextEncoder().encode(JSON.stringify(payload))
    }};
    await assert.rejects(read(attachments), /Annotation library unavailable.*Reload/);
    context.window.EmbeddedAnnotationUtils = utils;
    const restored = await read(attachments);
    assert.equal(restored.mode, 'native');
    assert.deepEqual(restored.payload, payload);
    assert.equal(await read({unrelated: {filename: 'notes.txt', content: new Uint8Array()}}), null);
    attachments.state.content = new TextEncoder().encode('{broken');
    await assert.rejects(read(attachments), /invalid JSON/);
    console.log('PDF loading tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
