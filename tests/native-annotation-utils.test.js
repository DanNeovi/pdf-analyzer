const assert = require('node:assert/strict');
const fs = require('node:fs');
const nativeUtils = require('../native-annotation-utils.js');
const embeddedUtils = require('../embedded-annotation-utils.js');

assert.deepEqual(nativeUtils.normalizedRect([40, 50, 10, 20]), [10, 20, 40, 50]);
assert.throws(() => nativeUtils.normalizedRect([1, 2, 3]), /invalid/);

let pdfLib;
try {
    pdfLib = require('pdf-lib');
} catch (error) {
    console.log('native annotation utility unit tests passed (pdf-lib integration skipped)');
    process.exit(0);
}

const onePixelPng = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
));

(async () => {
    const conflicting = await pdfLib.PDFDocument.create();
    conflicting.addPage([612, 792]);
    const rootRef = conflicting.context.trailerInfo.Root;
    const duplicateRef = pdfLib.PDFRef.of(rootRef.objectNumber, 1);
    const duplicateObject = conflicting.context.obj({Title: pdfLib.PDFHexString.fromText('Preserve me')});
    conflicting.context.assign(duplicateRef, duplicateObject);
    conflicting.context.trailerInfo.Info = duplicateRef;
    const refs = conflicting.context.obj([rootRef, duplicateRef]);
    conflicting.catalog.set(pdfLib.PDFName.of('TestReferences'), refs);
    const stream = conflicting.context.flateStream('test stream', {Related: duplicateRef});
    const streamRef = conflicting.context.register(stream);
    conflicting.catalog.set(pdfLib.PDFName.of('TestStream'), streamRef);
    assert.equal(nativeUtils.normalizeDuplicateObjectNumbers(conflicting, pdfLib), 1);
    assert.equal(nativeUtils.normalizeDuplicateObjectNumbers(conflicting, pdfLib), 0);
    assert.equal(refs.get(0), rootRef, 'unambiguous references stay intact');
    assert.notEqual(refs.get(1), duplicateRef);
    assert.equal(conflicting.context.lookup(refs.get(1)), duplicateObject);
    assert.equal(conflicting.context.trailerInfo.Info, refs.get(1));
    assert.equal(stream.dict.get(pdfLib.PDFName.of('Related')), refs.get(1));
    const repairedBytes = await conflicting.save({useObjectStreams: true});
    const repaired = await pdfLib.PDFDocument.load(repairedBytes);
    assert.equal(repaired.getPageCount(), 1);
    assert.equal(repaired.getTitle(), 'Preserve me');
    const objectNumbers = repaired.context.enumerateIndirectObjects().map(([ref]) => ref.objectNumber);
    assert.equal(new Set(objectNumbers).size, objectNumbers.length);

    const document = await pdfLib.PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(pdfLib.StandardFonts.Helvetica);
    page.drawText('Original page content', {x: 72, y: 720, size: 14, font});
    const originalContents = page.node.get(pdfLib.PDFName.of('Contents')).toString();
    const unrelated = document.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [10, 10, 30, 30],
        Contents: pdfLib.PDFHexString.fromText('Keep me')
    });
    const unrelatedRef = document.context.register(unrelated);
    page.node.set(pdfLib.PDFName.of('Annots'), document.context.obj([unrelatedRef]));

    const kinds = [
        'freeText', 'line', 'arrow', 'doubleArrow', 'square', 'circle',
        'cloud', 'ink', 'highlightPen', 'highlightBox', 'highlightEllipse', 'stamp'
    ];
    const descriptors = kinds.map((kind, index) => ({
        id: `annotation-${index}`,
        pageIndex: 0,
        kind,
        rect: [40 + index * 3, 60 + index * 3, 150 + index * 3, 120 + index * 3],
        color: [1, 0, 0],
        fillColor: kind === 'freeText' ? [1, 1, 1] : (kind.includes('highlight') ? [1, 1, 0] : null),
        opacity: kind.includes('highlight') ? 0.35 : 1,
        width: 2,
        contents: kind === 'freeText' ? 'Editable text' : '',
        fontSize: 14,
        line: [50, 70, 140, 110],
        inkLists: [[50, 70, 90, 105, 140, 110]],
        appearancePngBytes: onePixelPng
    }));

    assert.equal(await nativeUtils.replaceDraftNativeAnnotations(document, pdfLib, descriptors), kinds.length);
    assert.equal(page.node.get(pdfLib.PDFName.of('Contents')).toString(), originalContents, 'annotation writes must not flatten or replace page content');
    await document.attach(Uint8Array.from([1, 2, 3]), 'keep.bin');
    await embeddedUtils.embedNativeStateIntoPdf(document, {format: 'draftannotator.annotations', version: 1, pages: []});
    const bytes = await document.save();
    let reopened = await pdfLib.PDFDocument.load(bytes);
    const restored = nativeUtils.readDraftNativeAnnotations(reopened, pdfLib);
    assert.equal(restored.length, kinds.length);
    assert.deepEqual(restored.map(item => item.kind), kinds);
    assert.deepEqual(restored.find(item => item.kind === 'freeText').fillColor, [1, 1, 1],
        'replacement text must retain its opaque FreeText background');
    const reopenedAnnots = reopened.getPage(0).node.lookup(pdfLib.PDFName.of('Annots'), pdfLib.PDFArray);
    const editedFreeText = reopenedAnnots.lookup(1, pdfLib.PDFDict);
    editedFreeText.set(pdfLib.PDFName.of('Rect'), reopened.context.obj([200, 210, 340, 280]));
    editedFreeText.set(pdfLib.PDFName.of('Contents'), pdfLib.PDFHexString.fromText('Changed elsewhere'));
    editedFreeText.set(pdfLib.PDFName.of('C'), reopened.context.obj([0, 0, 1]));
    const externallyChanged = nativeUtils.readDraftNativeAnnotations(reopened, pdfLib).find(item => item.id === 'annotation-0');
    assert.deepEqual(externallyChanged.rect, [200, 210, 340, 280]);
    assert.equal(externallyChanged.contents, 'Changed elsewhere');
    assert.deepEqual(externallyChanged.color, [0, 0, 1]);

    assert.equal(nativeUtils.removeEmbeddedFilesByName(reopened, pdfLib, [embeddedUtils.NATIVE_ANNOTATIONS_NAME]), 1);
    await embeddedUtils.embedNativeStateIntoPdf(reopened, {format: 'draftannotator.annotations', version: 1, pages: []});
    reopened = await pdfLib.PDFDocument.load(await reopened.save());
    const namesDictionary = reopened.catalog.lookup(pdfLib.PDFName.of('Names'), pdfLib.PDFDict);
    const embeddedFiles = namesDictionary.lookup(pdfLib.PDFName.of('EmbeddedFiles'), pdfLib.PDFDict);
    const attachmentNames = embeddedFiles.lookup(pdfLib.PDFName.of('Names'), pdfLib.PDFArray);
    const listedAttachments = [];
    for(let index = 0; index < attachmentNames.size(); index += 2){
        listedAttachments.push(reopened.context.lookup(attachmentNames.get(index)).decodeText());
    }
    assert.deepEqual(listedAttachments.sort(), [embeddedUtils.NATIVE_ANNOTATIONS_NAME, 'keep.bin'].sort());
    await nativeUtils.replaceDraftNativeAnnotations(reopened, pdfLib, descriptors.slice(0, 2));
    assert.equal(nativeUtils.readDraftNativeAnnotations(reopened, pdfLib).length, 2, 'resave must replace, not duplicate, annotations');
    assert.equal(nativeUtils.stripDraftNativeAnnotations(reopened, pdfLib), 2);
    const remaining = reopened.getPage(0).node.lookup(pdfLib.PDFName.of('Annots'), pdfLib.PDFArray);
    assert.equal(remaining.size(), 1, 'unrelated PDF annotations must be preserved');
    assert.equal(nativeUtils.readDraftNativeAnnotations(reopened, pdfLib).length, 0);

    if (process.env.NATIVE_ANNOTATION_TEST_OUTPUT) {
        fs.writeFileSync(process.env.NATIVE_ANNOTATION_TEST_OUTPUT, bytes);
    }
    console.log('native annotation utility tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
