(function attachNativeAnnotationUtils(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    root.NativeAnnotationUtils=api;
}(typeof globalThis!=='undefined'?globalThis:this,function createNativeAnnotationUtils(){
    'use strict';

    const ANNOTATION_ID_PREFIX='draftannotator:';
    const PRODUCER='DraftAnnotator';
    const NATIVE_FORMAT_VERSION=1;

    // Incremental PDFs can retain different generations of one object number.
    // pdf-lib's writers emit an xref entry for each, corrupting the index when
    // the number is repeated. Give the extra objects unique numbers and update
    // references without discarding either generation or any attached data.
    function normalizeDuplicateObjectNumbers(pdfDocument,pdfLib){
        const context=pdfDocument.context;
        const objects=context.enumerateIndirectObjects();
        const seenNumbers=new Set(),replacements=new Map();
        for(const [ref,object] of objects){
            if(seenNumbers.has(ref.objectNumber)){
                replacements.set(ref,context.register(object));
                context.delete(ref);
            }else seenNumbers.add(ref.objectNumber);
        }
        if(!replacements.size)return 0;
        const visited=new Set();
        const rewrite=value=>{
            if(value instanceof pdfLib.PDFRef)return replacements.get(value)||value;
            if(!value||visited.has(value))return value;
            visited.add(value);
            if(value instanceof pdfLib.PDFDict){
                for(const [key,entry] of value.entries())value.set(key,rewrite(entry));
            }else if(value instanceof pdfLib.PDFArray){
                for(let i=0;i<value.size();i++)value.set(i,rewrite(value.get(i)));
            }else if(value instanceof pdfLib.PDFStream)rewrite(value.dict);
            return value;
        };
        for(const [,object] of context.enumerateIndirectObjects())rewrite(object);
        for(const key of Object.keys(context.trailerInfo)){
            context.trailerInfo[key]=rewrite(context.trailerInfo[key]);
        }
        return replacements.size;
    }

    function pdfNameText(value){
        if(!value)return '';
        if(typeof value.decodeText==='function')return value.decodeText();
        if(typeof value.asString==='function')return value.asString().replace(/^\//,'');
        return String(value).replace(/^\//,'');
    }

    function pdfStringText(value){
        if(!value)return '';
        if(typeof value.decodeText==='function')return value.decodeText();
        if(typeof value.asString==='function')return value.asString();
        return '';
    }

    function numberValue(value){
        return value&&typeof value.asNumber==='function'?value.asNumber():Number(value);
    }

    function arrayNumbers(pdfDocument,array){
        if(!array||typeof array.size!=='function')return [];
        const values=[];
        for(let index=0;index<array.size();index++){
            const value=pdfDocument.context.lookup(array.get(index));
            const numeric=numberValue(value);
            if(Number.isFinite(numeric))values.push(numeric);
        }
        return values;
    }

    function nestedNumberArrays(pdfDocument,array){
        if(!array||typeof array.size!=='function')return [];
        const values=[];
        for(let index=0;index<array.size();index++){
            const item=pdfDocument.context.lookup(array.get(index));
            const numbers=arrayNumbers(pdfDocument,item);
            if(numbers.length)values.push(numbers);
        }
        return values;
    }

    function normalizedRect(rect){
        const values=Array.isArray(rect)?rect.map(Number):[];
        if(values.length!==4||values.some(value=>!Number.isFinite(value)))throw new Error('Native annotation rectangle is invalid.');
        return [
            Math.min(values[0],values[2]),
            Math.min(values[1],values[3]),
            Math.max(values[0],values[2]),
            Math.max(values[1],values[3])
        ];
    }

    function normalizedColor(color){
        if(!Array.isArray(color)||color.length<3)return [0,0,0];
        return color.slice(0,3).map(value=>Math.max(0,Math.min(1,Number(value)||0)));
    }

    function getDraftAnnotationId(pdfDocument,dict,pdfLib){
        const nm=pdfStringText(lookupWithLib(pdfDocument,dict,'NM',pdfLib));
        const producer=pdfStringText(lookupWithLib(pdfDocument,dict,'DAProducer',pdfLib));
        if(nm.startsWith(ANNOTATION_ID_PREFIX))return nm.slice(ANNOTATION_ID_PREFIX.length);
        if(producer===PRODUCER&&nm)return nm;
        return '';
    }

    function lookupWithLib(pdfDocument,container,key,pdfLib){
        if(!container||typeof container.get!=='function')return null;
        const raw=container.get(pdfLib.PDFName.of(key));
        return raw?pdfDocument.context.lookup(raw):null;
    }

    function attachmentFileName(pdfDocument,pdfLib,fileSpec){
        if(!(fileSpec instanceof pdfLib.PDFDict))return '';
        return pdfStringText(lookupWithLib(pdfDocument,fileSpec,'UF',pdfLib))||
            pdfStringText(lookupWithLib(pdfDocument,fileSpec,'F',pdfLib));
    }

    function refreshNameTreeLimits(pdfDocument,pdfLib,node){
        if(!(node instanceof pdfLib.PDFDict))return;
        const names=lookupWithLib(pdfDocument,node,'Names',pdfLib);
        if(names instanceof pdfLib.PDFArray&&names.size()>=2){
            node.set(pdfLib.PDFName.of('Limits'),pdfDocument.context.obj([
                names.get(0),names.get(names.size()-2)
            ]));
            return;
        }
        const kids=lookupWithLib(pdfDocument,node,'Kids',pdfLib);
        if(kids instanceof pdfLib.PDFArray&&kids.size()){
            const firstKid=pdfDocument.context.lookup(kids.get(0));
            const lastKid=pdfDocument.context.lookup(kids.get(kids.size()-1));
            const firstLimits=lookupWithLib(pdfDocument,firstKid,'Limits',pdfLib);
            const lastLimits=lookupWithLib(pdfDocument,lastKid,'Limits',pdfLib);
            if(firstLimits instanceof pdfLib.PDFArray&&firstLimits.size()>=2&&
                lastLimits instanceof pdfLib.PDFArray&&lastLimits.size()>=2){
                node.set(pdfLib.PDFName.of('Limits'),pdfDocument.context.obj([
                    firstLimits.get(0),lastLimits.get(lastLimits.size()-1)
                ]));
                return;
            }
        }
        node.delete(pdfLib.PDFName.of('Limits'));
    }

    function removeNameTreeEntries(pdfDocument,pdfLib,node,namesToRemove,removedRefs){
        if(!(node instanceof pdfLib.PDFDict))return 0;
        let removed=0;
        const names=lookupWithLib(pdfDocument,node,'Names',pdfLib);
        if(names instanceof pdfLib.PDFArray){
            const kept=[];
            for(let index=0;index+1<names.size();index+=2){
                const nameRaw=names.get(index);
                const fileRaw=names.get(index+1);
                const listedName=pdfStringText(pdfDocument.context.lookup(nameRaw));
                const fileSpec=pdfDocument.context.lookup(fileRaw);
                const fileName=attachmentFileName(pdfDocument,pdfLib,fileSpec)||listedName;
                if(namesToRemove.has(fileName)){
                    removed++;
                    if(fileRaw instanceof pdfLib.PDFRef)removedRefs.add(fileRaw.toString());
                }else{
                    kept.push(nameRaw,fileRaw);
                }
            }
            if(kept.length)node.set(pdfLib.PDFName.of('Names'),pdfDocument.context.obj(kept));
            else node.delete(pdfLib.PDFName.of('Names'));
        }
        const kids=lookupWithLib(pdfDocument,node,'Kids',pdfLib);
        if(kids instanceof pdfLib.PDFArray){
            const keptKids=[];
            for(let index=0;index<kids.size();index++){
                const kidRaw=kids.get(index);
                const kid=pdfDocument.context.lookup(kidRaw);
                removed+=removeNameTreeEntries(pdfDocument,pdfLib,kid,namesToRemove,removedRefs);
                const kidNames=lookupWithLib(pdfDocument,kid,'Names',pdfLib);
                const kidChildren=lookupWithLib(pdfDocument,kid,'Kids',pdfLib);
                if((kidNames instanceof pdfLib.PDFArray&&kidNames.size())||
                    (kidChildren instanceof pdfLib.PDFArray&&kidChildren.size()))keptKids.push(kidRaw);
            }
            if(keptKids.length)node.set(pdfLib.PDFName.of('Kids'),pdfDocument.context.obj(keptKids));
            else node.delete(pdfLib.PDFName.of('Kids'));
        }
        refreshNameTreeLimits(pdfDocument,pdfLib,node);
        return removed;
    }

    function removeEmbeddedFilesByName(pdfDocument,pdfLib,fileNames){
        const namesToRemove=new Set((fileNames||[]).map(String));
        if(!namesToRemove.size)return 0;
        const names=lookupWithLib(pdfDocument,pdfDocument.catalog,'Names',pdfLib);
        const embeddedFiles=lookupWithLib(pdfDocument,names,'EmbeddedFiles',pdfLib);
        const removedRefs=new Set();
        const removed=removeNameTreeEntries(pdfDocument,pdfLib,embeddedFiles,namesToRemove,removedRefs);
        if(names instanceof pdfLib.PDFDict&&embeddedFiles instanceof pdfLib.PDFDict){
            const remainingNames=lookupWithLib(pdfDocument,embeddedFiles,'Names',pdfLib);
            const remainingKids=lookupWithLib(pdfDocument,embeddedFiles,'Kids',pdfLib);
            if(!(remainingNames instanceof pdfLib.PDFArray&&remainingNames.size())&&
                !(remainingKids instanceof pdfLib.PDFArray&&remainingKids.size())){
                names.delete(pdfLib.PDFName.of('EmbeddedFiles'));
            }
        }
        const associated=lookupWithLib(pdfDocument,pdfDocument.catalog,'AF',pdfLib);
        if(associated instanceof pdfLib.PDFArray){
            const kept=[];
            for(let index=0;index<associated.size();index++){
                const raw=associated.get(index);
                const fileSpec=pdfDocument.context.lookup(raw);
                const fileName=attachmentFileName(pdfDocument,pdfLib,fileSpec);
                if(!namesToRemove.has(fileName)&&!(raw instanceof pdfLib.PDFRef&&removedRefs.has(raw.toString())))kept.push(raw);
            }
            if(kept.length)pdfDocument.catalog.set(pdfLib.PDFName.of('AF'),pdfDocument.context.obj(kept));
            else pdfDocument.catalog.delete(pdfLib.PDFName.of('AF'));
        }
        return removed;
    }

    function readDraftNativeAnnotations(pdfDocument,pdfLib){
        if(!pdfDocument||!pdfLib)throw new Error('PDF document and pdf-lib are required.');
        const descriptors=[];
        const pages=pdfDocument.getPages();
        pages.forEach((page,pageIndex)=>{
            const annots=lookupWithLib(pdfDocument,page.node,'Annots',pdfLib);
            if(!(annots instanceof pdfLib.PDFArray))return;
            for(let index=0;index<annots.size();index++){
                const raw=annots.get(index);
                const dict=pdfDocument.context.lookup(raw);
                if(!(dict instanceof pdfLib.PDFDict))continue;
                const id=getDraftAnnotationId(pdfDocument,dict,pdfLib);
                if(!id)continue;
                const subtype=pdfNameText(lookupWithLib(pdfDocument,dict,'Subtype',pdfLib));
                const kind=pdfStringText(lookupWithLib(pdfDocument,dict,'DAKind',pdfLib))||subtype;
                const rect=arrayNumbers(pdfDocument,lookupWithLib(pdfDocument,dict,'Rect',pdfLib));
                if(rect.length!==4)continue;
                const bs=lookupWithLib(pdfDocument,dict,'BS',pdfLib);
                const width=numberValue(lookupWithLib(pdfDocument,bs,'W',pdfLib));
                const opacity=numberValue(lookupWithLib(pdfDocument,dict,'CA',pdfLib));
                const color=arrayNumbers(pdfDocument,lookupWithLib(pdfDocument,dict,'C',pdfLib));
                const fillColor=arrayNumbers(pdfDocument,lookupWithLib(pdfDocument,dict,'IC',pdfLib));
                const lineEndings=lookupWithLib(pdfDocument,dict,'LE',pdfLib);
                const endings=[];
                if(lineEndings instanceof pdfLib.PDFArray){
                    for(let endingIndex=0;endingIndex<lineEndings.size();endingIndex++){
                        endings.push(pdfNameText(pdfDocument.context.lookup(lineEndings.get(endingIndex))));
                    }
                }
                descriptors.push({
                    id,
                    pageIndex,
                    subtype,
                    kind,
                    rect:normalizedRect(rect),
                    color:color.length>=3?normalizedColor(color):[0,0,0],
                    fillColor:fillColor.length>=3?normalizedColor(fillColor):null,
                    opacity:Number.isFinite(opacity)?opacity:1,
                    width:Number.isFinite(width)?width:1,
                    contents:pdfStringText(lookupWithLib(pdfDocument,dict,'Contents',pdfLib)),
                    line:arrayNumbers(pdfDocument,lookupWithLib(pdfDocument,dict,'L',pdfLib)),
                    inkLists:nestedNumberArrays(pdfDocument,lookupWithLib(pdfDocument,dict,'InkList',pdfLib)),
                    vertices:arrayNumbers(pdfDocument,lookupWithLib(pdfDocument,dict,'Vertices',pdfLib)),
                    lineEndings:endings,
                    modifiedAt:pdfStringText(lookupWithLib(pdfDocument,dict,'M',pdfLib))
                });
            }
        });
        return descriptors;
    }

    function annotationSubtype(kind){
        switch(kind){
            case 'freeText':return 'FreeText';
            case 'line':case 'arrow':case 'doubleArrow':return 'Line';
            case 'square':case 'highlightBox':case 'cloud':return 'Square';
            case 'circle':case 'highlightEllipse':return 'Circle';
            case 'ink':case 'highlightPen':return 'Ink';
            case 'polygon':return 'Polygon';
            default:return 'Stamp';
        }
    }

    function makeText(pdfLib,value){
        return pdfLib.PDFHexString.fromText(String(value||''));
    }

    function makeDate(pdfLib){
        return typeof pdfLib.PDFString.fromDate==='function'
            ?pdfLib.PDFString.fromDate(new Date())
            :pdfLib.PDFString.of(`D:${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`);
    }

    async function createAppearance(pdfDocument,pdfLib,descriptor){
        const bytes=descriptor.appearancePngBytes;
        if(!(bytes instanceof Uint8Array)||!bytes.length)return null;
        const rect=normalizedRect(descriptor.rect);
        const width=Math.max(0.01,rect[2]-rect[0]);
        const height=Math.max(0.01,rect[3]-rect[1]);
        const image=await pdfDocument.embedPng(bytes);
        const imageName=pdfLib.PDFName.of('Img');
        const xObjects=pdfDocument.context.obj({});
        xObjects.set(imageName,image.ref);
        const resources=pdfDocument.context.obj({XObject:xObjects});
        const stream=pdfDocument.context.flateStream(
            `q ${width} 0 0 ${height} 0 0 cm /Img Do Q`,
            {
                Type:'XObject',
                Subtype:'Form',
                FormType:1,
                BBox:[0,0,width,height],
                Resources:resources,
                Group:{S:'Transparency',CS:'DeviceRGB',I:true,K:false}
            }
        );
        return pdfDocument.context.register(stream);
    }

    function addSubtypeEntries(dict,descriptor,pdfDocument,pdfLib){
        const context=pdfDocument.context;
        const kind=descriptor.kind;
        const color=normalizedColor(descriptor.color);
        const width=Math.max(0,Number(descriptor.width)||0);
        const borderStyle=context.obj({Type:'Border',W:width,S:'S'});
        dict.set(pdfLib.PDFName.of('BS'),borderStyle);

        if(kind==='freeText'){
            const fontSize=Math.max(1,Number(descriptor.fontSize)||12);
            dict.set(pdfLib.PDFName.of('DA'),pdfLib.PDFString.of(
                `/Helv ${fontSize} Tf ${color[0]} ${color[1]} ${color[2]} rg`));
            dict.set(pdfLib.PDFName.of('Q'),context.obj(Number(descriptor.alignment)||0));
            dict.set(pdfLib.PDFName.of('IT'),pdfLib.PDFName.of('FreeTextTypeWriter'));
        }else if(kind==='line'||kind==='arrow'||kind==='doubleArrow'){
            const line=Array.isArray(descriptor.line)&&descriptor.line.length===4?descriptor.line:descriptor.rect;
            dict.set(pdfLib.PDFName.of('L'),context.obj(line));
            const endings=kind==='doubleArrow'?['ClosedArrow','ClosedArrow']:
                (kind==='arrow'?['None','ClosedArrow']:['None','None']);
            dict.set(pdfLib.PDFName.of('LE'),context.obj(endings));
            if(kind!=='line')dict.set(pdfLib.PDFName.of('IT'),pdfLib.PDFName.of('LineArrow'));
            if(kind!=='line')dict.set(pdfLib.PDFName.of('IC'),context.obj(color));
        }else if(kind==='ink'||kind==='highlightPen'){
            const inkLists=(descriptor.inkLists||[]).filter(list=>Array.isArray(list)&&list.length>=4);
            dict.set(pdfLib.PDFName.of('InkList'),context.obj(inkLists.length?inkLists:[[descriptor.rect[0],descriptor.rect[1],descriptor.rect[2],descriptor.rect[3]]]));
        }else if(kind==='polygon'){
            dict.set(pdfLib.PDFName.of('Vertices'),context.obj(descriptor.vertices||descriptor.rect));
        }else if(kind==='cloud'){
            dict.set(pdfLib.PDFName.of('BE'),context.obj({S:'C',I:2}));
            dict.set(pdfLib.PDFName.of('RD'),context.obj([width,width,width,width]));
        }else if(annotationSubtype(kind)==='Stamp'){
            dict.set(pdfLib.PDFName.of('Name'),pdfLib.PDFName.of('Draft'));
        }

        if(Array.isArray(descriptor.fillColor)){
            dict.set(pdfLib.PDFName.of('IC'),context.obj(normalizedColor(descriptor.fillColor)));
        }
    }

    async function buildAnnotationDictionary(pdfDocument,pdfLib,page,descriptor){
        const context=pdfDocument.context;
        const rect=normalizedRect(descriptor.rect);
        const color=normalizedColor(descriptor.color);
        const kind=String(descriptor.kind||'stamp');
        const now=makeDate(pdfLib);
        const rawOpacity=Number(descriptor.opacity);
        const opacity=Number.isFinite(rawOpacity)?Math.max(0,Math.min(1,rawOpacity)):1;
        const dict=context.obj({
            Type:'Annot',
            Subtype:annotationSubtype(kind),
            Rect:rect,
            P:page.ref,
            NM:makeText(pdfLib,`${ANNOTATION_ID_PREFIX}${descriptor.id}`),
            M:now,
            CreationDate:now,
            F:4,
            C:color,
            CA:opacity,
            Contents:makeText(pdfLib,descriptor.contents||''),
            T:makeText(pdfLib,PRODUCER),
            Subj:makeText(pdfLib,`DraftAnnotator ${kind}`),
            DAProducer:makeText(pdfLib,PRODUCER),
            DAKind:makeText(pdfLib,kind),
            DAFormat:NATIVE_FORMAT_VERSION
        });
        addSubtypeEntries(dict,descriptor,pdfDocument,pdfLib);
        const appearanceRef=await createAppearance(pdfDocument,pdfLib,descriptor);
        if(appearanceRef)dict.set(pdfLib.PDFName.of('AP'),context.obj({N:appearanceRef}));
        return dict;
    }

    function getPageAnnotationEntries(pdfDocument,pdfLib,page){
        const annots=lookupWithLib(pdfDocument,page.node,'Annots',pdfLib);
        if(!(annots instanceof pdfLib.PDFArray))return [];
        const entries=[];
        for(let index=0;index<annots.size();index++)entries.push(annots.get(index));
        return entries;
    }

    function draftEntryInfo(pdfDocument,pdfLib,raw){
        const dict=pdfDocument.context.lookup(raw);
        if(!(dict instanceof pdfLib.PDFDict))return null;
        const id=getDraftAnnotationId(pdfDocument,dict,pdfLib);
        return id?{id,dict,raw}:null;
    }

    async function replaceDraftNativeAnnotations(pdfDocument,pdfLib,descriptors){
        if(!pdfDocument||!pdfLib)throw new Error('PDF document and pdf-lib are required.');
        const pages=pdfDocument.getPages();
        const byPage=new Map();
        (descriptors||[]).forEach(descriptor=>{
            const pageIndex=Number(descriptor&&descriptor.pageIndex);
            if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pages.length)throw new Error('Native annotation page is invalid.');
            if(!descriptor.id)throw new Error('Native annotation ID is required.');
            if(!byPage.has(pageIndex))byPage.set(pageIndex,[]);
            byPage.get(pageIndex).push(descriptor);
        });

        let written=0;
        for(let pageIndex=0;pageIndex<pages.length;pageIndex++){
            const page=pages[pageIndex];
            const existing=getPageAnnotationEntries(pdfDocument,pdfLib,page);
            const kept=[];
            const reusable=new Map();
            existing.forEach(raw=>{
                const info=draftEntryInfo(pdfDocument,pdfLib,raw);
                if(info)reusable.set(info.id,info.raw);
                else kept.push(raw);
            });
            const next=[...kept];
            for(const descriptor of byPage.get(pageIndex)||[]){
                const dict=await buildAnnotationDictionary(pdfDocument,pdfLib,page,descriptor);
                const reusableRef=reusable.get(descriptor.id);
                if(reusableRef instanceof pdfLib.PDFRef){
                    pdfDocument.context.assign(reusableRef,dict);
                    next.push(reusableRef);
                }else{
                    next.push(pdfDocument.context.register(dict));
                }
                written++;
            }
            if(next.length)page.node.set(pdfLib.PDFName.of('Annots'),pdfDocument.context.obj(next));
            else page.node.delete(pdfLib.PDFName.of('Annots'));
        }
        return written;
    }

    function stripDraftNativeAnnotations(pdfDocument,pdfLib){
        let removed=0;
        pdfDocument.getPages().forEach(page=>{
            const existing=getPageAnnotationEntries(pdfDocument,pdfLib,page);
            if(!existing.length)return;
            const kept=existing.filter(raw=>{
                const isDraft=!!draftEntryInfo(pdfDocument,pdfLib,raw);
                if(isDraft)removed++;
                return !isDraft;
            });
            if(kept.length)page.node.set(pdfLib.PDFName.of('Annots'),pdfDocument.context.obj(kept));
            else page.node.delete(pdfLib.PDFName.of('Annots'));
        });
        return removed;
    }

    return {
        ANNOTATION_ID_PREFIX,
        NATIVE_FORMAT_VERSION,
        PRODUCER,
        normalizeDuplicateObjectNumbers,
        normalizedRect,
        readDraftNativeAnnotations,
        removeEmbeddedFilesByName,
        replaceDraftNativeAnnotations,
        stripDraftNativeAnnotations
    };
}));
