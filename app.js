window.addEventListener('unhandledrejection',e=>{
    console.error('Unhandled rejection:',e.reason);
});
if(window.pdfjsLib){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Fallback keeps the editor bootable when a stale service worker or browser
// extension drops editor-utils.js. The standalone file remains canonical.
if(!window.EditorUtils){
    const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
    const getContainTransform=(sourceWidth,sourceHeight,targetWidth,targetHeight)=>{
        const sw=Number(sourceWidth)>0?Number(sourceWidth):Number(targetWidth)||1;
        const sh=Number(sourceHeight)>0?Number(sourceHeight):Number(targetHeight)||1;
        const tw=Number(targetWidth)>0?Number(targetWidth):sw;
        const th=Number(targetHeight)>0?Number(targetHeight):sh;
        const scale=Math.min(tw/sw,th/sh);
        return {scale,offsetX:(tw-sw*scale)/2,offsetY:(th-sh*scale)/2};
    };
    const normalizeRotation=angle=>{
        const rotation=((Math.round(Number(angle)||0)%360)+360)%360;
        return rotation===90||rotation===180||rotation===270?rotation:0;
    };
    const winAnsiExtras=new Set([0x20ac,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,0x02c6,0x2030,0x0160,0x2039,0x0152,0x017d,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x02dc,0x2122,0x0161,0x203a,0x0153,0x017e,0x0178]);
    window.EditorUtils={
        getContainTransform,
        getContainedImagePlacement(imageWidth,imageHeight,canvasWidth,canvasHeight,desiredX,desiredY,maxFraction=0.8){
            const iw=Math.max(1,Number(imageWidth)||1),ih=Math.max(1,Number(imageHeight)||1);
            const cw=Math.max(1,Number(canvasWidth)||1),ch=Math.max(1,Number(canvasHeight)||1);
            const fraction=clamp(Number(maxFraction)||0.8,0.05,1),scale=Math.min(1,(cw*fraction)/iw,(ch*fraction)/ih);
            const width=iw*scale,height=ih*scale;
            const requestedX=Number.isFinite(Number(desiredX))?Number(desiredX):cw/2;
            const requestedY=Number.isFinite(Number(desiredY))?Number(desiredY):ch/2;
            return {scale,width,height,x:width>=cw?cw/2:clamp(requestedX,width/2,cw-width/2),y:height>=ch?ch/2:clamp(requestedY,height/2,ch-height/2)};
        },
        getBoundsTranslationInsideContainer(bounds,containerWidth,containerHeight,padding=0){
            const x=Number(bounds&&bounds.x)||0,y=Number(bounds&&bounds.y)||0;
            const width=Math.max(0,Number(bounds&&bounds.width)||0),height=Math.max(0,Number(bounds&&bounds.height)||0);
            const cw=Math.max(1,Number(containerWidth)||1),ch=Math.max(1,Number(containerHeight)||1),pad=clamp(Number(padding)||0,0,Math.min(cw,ch)/2);
            const targetX=width>cw-pad*2?(cw-width)/2:clamp(x,pad,cw-pad-width);
            const targetY=height>ch-pad*2?(ch-height)/2:clamp(y,pad,ch-pad-height);
            return {dx:targetX-x,dy:targetY-y};
        },
        getClipboardObjectPlacement(object,sourceWidth,sourceHeight,targetWidth,targetHeight,delta=0){
            const transform=getContainTransform(sourceWidth,sourceHeight,targetWidth,targetHeight),offset=Number(delta)||0;
            return {left:transform.offsetX+(Number(object&&object.left)||0)*transform.scale+offset,top:transform.offsetY+(Number(object&&object.top)||0)*transform.scale+offset,scaleX:(Number(object&&object.scaleX)||1)*transform.scale,scaleY:(Number(object&&object.scaleY)||1)*transform.scale};
        },
        getPageTextReplacementPlacement(metrics){
            const lw=Math.max(1,Number(metrics&&metrics.layerWidth)||1),lh=Math.max(1,Number(metrics&&metrics.layerHeight)||1);
            const sw=Math.max(1,Number(metrics&&metrics.sceneWidth)||lw),sh=Math.max(1,Number(metrics&&metrics.sceneHeight)||lh);
            const sx=sw/lw,sy=sh/lh;
            return {left:(Number(metrics&&metrics.offsetLeft)||0)*sx,top:(Number(metrics&&metrics.offsetTop)||0)*sy,width:Math.max(8,(Number(metrics&&metrics.offsetWidth)||8)*Math.max(0.01,Number(metrics&&metrics.transformScaleX)||1)*sx),fontSize:Math.max(4,(Number(metrics&&metrics.fontSize)||12)*sy),angle:Number(metrics&&metrics.angle)||0};
        },
        getClipboardImageBlob(clipboardData){
            if(!clipboardData)return null;
            for(const item of Array.from(clipboardData.items||[])){
                if(item.kind==='file'&&/^image\//i.test(item.type||'')){
                    const file=typeof item.getAsFile==='function'?item.getAsFile():null;
                    if(file)return file;
                }
            }
            return Array.from(clipboardData.files||[]).find(file=>/^image\//i.test(file.type||''))||null;
        },
        isWinAnsiCompatibleText(value){
            for(const character of String(value||'')){
                const code=character.codePointAt(0);
                if(code===0x0a||code===0x0d)continue;
                if((code>=0x20&&code<=0x7e)||(code>=0xa0&&code<=0xff)||winAnsiExtras.has(code))continue;
                return false;
            }
            return true;
        },
        normalizeRotation,
        rotatePixelRect(rect,sourceWidth,sourceHeight,rotation){
            switch(normalizeRotation(rotation)){
                case 90:return {x:rect.y,y:sourceWidth-(rect.x+rect.width),width:rect.height,height:rect.width};
                case 180:return {x:sourceWidth-(rect.x+rect.width),y:sourceHeight-(rect.y+rect.height),width:rect.width,height:rect.height};
                case 270:return {x:sourceHeight-(rect.y+rect.height),y:rect.x,width:rect.height,height:rect.width};
                default:return {...rect};
            }
        }
    };
}

// ─── STATE ──────────────────────────────────────────
let pdfDoc=null,numPages=0,scale=1.5,activeTool='select';
let currentFontSize=16,currentFontFamily='sans-serif';
let currentColor='#ef4444',currentStrokeWidth=3;
let isPanning=false,panStartX=0,panStartY=0,panOffsetX=0,panOffsetY=0;
let hasUnsavedChanges=false,currentFileName='';
let originalPdfBytes=null;
let textEditJustExited=false;
let hasPendingTextEdits=false;
let pageIndicatorTimer=null;
let renderedPages=new Set();
const renderingPages=new Set();
let pageRenderObserver=null;
let baseScale=null;
let currentVisiblePage=1;
const pageViewportCache=new Map();
let pageTextContentCache=new WeakMap();
const searchTextByPage=new Map();

const pdfViewer=document.getElementById('pdfViewer'),fileInput=document.getElementById('fileInput');
const btnLoadPdf=document.getElementById('btnLoadPdf'),btnSavePdf=document.getElementById('btnSavePdf');
const btnUndo=document.getElementById('btnUndo'),btnRedo=document.getElementById('btnRedo');
const btnShortcutSettings=document.getElementById('btnShortcutSettings');
const fontControlsGroup=document.getElementById('fontControlsGroup');
const fontFamilySelect=document.getElementById('fontFamilySelect');
const sizeSlider=document.getElementById('sizeSlider'),sizeNumber=document.getElementById('sizeNumber'),sizeLabel=document.getElementById('sizeLabel');
const fillControlsGroup=document.getElementById('fillControlsGroup');
const fillDivider=document.getElementById('fillDivider');
const fillToggle=document.getElementById('fillToggle');
const fillOpacitySlider=document.getElementById('fillOpacitySlider');
const fillOpacityNumber=document.getElementById('fillOpacityNumber');

const arrowModeGroup=document.getElementById('arrowModeGroup');
const arrowModeSelect=document.getElementById('arrowModeSelect');
const highlightModeGroup=document.getElementById('highlightModeGroup');
const highlightModeDivider=document.getElementById('highlightModeDivider');
const highlightModeSelect=document.getElementById('highlightModeSelect');
const pageNavGroup=document.getElementById('pageNavGroup');
const pageJumpInput=document.getElementById('pageJumpInput');
const pageJumpTotal=document.getElementById('pageJumpTotal');
const btnPrevPage=document.getElementById('btnPrevPage');
const btnNextPage=document.getElementById('btnNextPage');
const loadingOverlay=document.getElementById('loadingOverlay');
const initialShortcutHint=document.getElementById('initialShortcutHint');
const shortcutReferenceList=document.getElementById('shortcutReferenceList');
const shortcutSettingsModal=document.getElementById('shortcutSettingsModal');
const settingsMaxStrokeSize=document.getElementById('settingsMaxStrokeSize');
const settingsMaxTextSize=document.getElementById('settingsMaxTextSize');
const btnCloseShortcutSettings=document.getElementById('btnCloseShortcutSettings');
const btnCancelShortcutSettings=document.getElementById('btnCancelShortcutSettings');
const btnSaveShortcutSettings=document.getElementById('btnSaveShortcutSettings');
const btnImportSettings=document.getElementById('btnImportSettings');
const btnExportSettingsJson=document.getElementById('btnExportSettingsJson');
const btnExportSettingsCsv=document.getElementById('btnExportSettingsCsv');
const btnResetShortcutDefaults=document.getElementById('btnResetShortcutDefaults');
const settingsImportInput=document.getElementById('settingsImportInput');
const shortcutToolRows=document.getElementById('shortcutToolRows');
const shortcutActionRows=document.getElementById('shortcutActionRows');
const shortcutSettingsStatus=document.getElementById('shortcutSettingsStatus');
const specialStudStatus=document.getElementById('specialStudStatus');
const specialStudResults=document.getElementById('specialStudResults');
const specialStudPieceCount=document.getElementById('specialStudPieceCount');
const specialStudTypeCount=document.getElementById('specialStudTypeCount');
const specialStudWeight=document.getElementById('specialStudWeight');
const specialStudGaugeSummary=document.getElementById('specialStudGaugeSummary');
const specialStudRowCount=document.getElementById('specialStudRowCount');
const specialStudRows=document.getElementById('specialStudRows');
const btnExportSpecialStudCsv=document.getElementById('btnExportSpecialStudCsv');
const fabricCanvases=new Map();

const savedStateByPage=new Map();
const pendingEmbeddedPageAnnotations=new Map();
const historyStack=[];
let historyPointer=-1;
const SERIALIZED_ANNOTATION_PROPS=['annotationType','selectable','evented','_hlBaseColor','draftAnnotationId','pageTextSourceId','pageTextOriginal'];
const CLIPBOARD_OBJECT_PROPS=['annotationType','_hlBaseColor','pageTextSourceId','pageTextOriginal'];
const KEYBOARD_PASTE_OFFSET=15;
const INTERNAL_CLIPBOARD_MIME='application/x-draftannotator-objects';
const INTERNAL_CLIPBOARD_MARKER='DraftAnnotator annotation objects';
const MAX_INSERT_IMAGE_BYTES=20*1024*1024;
const DEFAULT_MAX_STROKE_SIZE=50;
const DEFAULT_MAX_TEXT_SIZE=300;
let objectClipboard=null;
let clipboardPasteCount=0;
let toolBeforeColorPopover=null;
let lastCanvasMousePos=null;

const PAGE_SCALE_ADJUST=0.98;
const ARROW_MODE_OPTIONS=['single','double','note'];
const ARROW_NOTE_SIDE_OPTIONS=['head','tail'];
const HIGHLIGHT_MODE_OPTIONS=['pen','box','ellipse'];
const PREF_KEY_ARROW_MODE='draftannotator.arrow.mode';
const PREF_KEY_ARROW_NOTE_SIDE='draftannotator.arrow.noteSide';
const PREF_KEY_HIGHLIGHT_MODE='draftannotator.highlight.mode';
const PREF_KEY_RECENT_COLORS='draftannotator.recentColors';
const PREF_KEY_SHORTCUTS='draftannotator.shortcuts';
const PREF_KEY_EDITOR_SETTINGS='draftannotator.editorSettings';
const PREF_KEY_TOOLBAR_STATE='draftannotator.toolbarState';
let defaultPageSize={w:900,h:1200};
let arrowMode='single';
let arrowNoteSide='head';
let highlightMode='pen';
let zoomFactor=1.0; // 1.0 = fit-to-width (100%)
let pendingResizeFocus=null;
let shapeFillEnabled=false;
let shapeFillOpacity=25;
let activeContextPageNum=1;
let suppressTextEditingLifecycle=false;
const activePdfRenderTasks=new Map();
const pendingPdfRefreshPages=new Set();
let queuedZoomFactor=null;
let zoomWorkerActive=false;
let maxStrokeSize=DEFAULT_MAX_STROKE_SIZE;
let maxTextSize=DEFAULT_MAX_TEXT_SIZE;
let specialStudAnalysisRows=[];
let specialStudAnalysisRun=0;
let specialStudAnalysisTimer=null;

const FABRIC_MAJOR_VERSION=parseInt(String(window.fabric&&window.fabric.version||'5').split('.')[0],10)||5;

// Fabric 6/7 serializes custom fields through a class-level allow-list. Keep
// the explicit JSON patch below as well because some minor releases ignore
// Canvas#toJSON(propertiesToInclude) even when object serialization supports it.
const FABRIC_SERIALIZABLE_CLASSES=window.fabric?[window.fabric.FabricObject,window.fabric.Object]:[];
FABRIC_SERIALIZABLE_CLASSES.filter(Boolean).forEach(ObjectClass=>{
    ObjectClass.customProperties=Array.from(new Set([
        ...(ObjectClass.customProperties||[]),
        ...SERIALIZED_ANNOTATION_PROPS
    ]));
});

function getFabricObjectType(object){
    return String(object&&object.type||object&&object.constructor&&object.constructor.type||'').toLowerCase().replace(/-/g,'');
}

function isFabricType(object,...types){
    const actual=getFabricObjectType(object);
    return types.some(type=>actual===String(type).toLowerCase().replace(/-/g,''));
}

function getCanvasScenePoint(canvas,event){
    return typeof canvas.getScenePoint==='function'?canvas.getScenePoint(event):canvas.getPointer(event);
}

function setFabricCanvasDimensions(canvas,width,height){
    if(typeof canvas.setDimensions==='function')canvas.setDimensions({width,height});
    else{canvas.setWidth(width);canvas.setHeight(height);}
}

function loadFabricCanvasFromJson(canvas,json,onComplete,reviver){
    let task;
    if(FABRIC_MAJOR_VERSION>=6)task=canvas.loadFromJSON(json,reviver);
    else task=new Promise((resolve,reject)=>{
        try{canvas.loadFromJSON(json,resolve,reviver);}catch(error){reject(error);}
    });
    return Promise.resolve(task).then(()=>{
        if(typeof onComplete==='function')onComplete();
        return canvas;
    });
}

const TOOL_NAMES={select:'Select',draw:'Pencil',line:'Line',arrow:'Arrow',rect:'Rectangle',circle:'Circle',text:'Text',pageText:'Edit PDF Text',highlight:'Highlight',cloud:'Rev Cloud'};
const SHAPE_TOOLS=['line','arrow','rect','circle','cloud'];
const SHORTCUT_SCHEMA_VERSION=3;
const SHORTCUT_MODIFIER_CODES=new Set(['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight']);
const SHORTCUT_TOOL_FIELDS=[
    {id:'select',label:'Select tool',description:'Switch to select mode.',defaults:['Digit1','KeyS']},
    {id:'draw',label:'Pencil tool',description:'Switch to freehand drawing.',defaults:['Digit2','KeyD']},
    {id:'text',label:'Text tool',description:'Place a text annotation.',defaults:['Digit3','KeyT']},
    {id:'pageText',label:'Edit PDF text',description:'Replace existing page text with a reversible editable FreeText annotation.',defaults:['KeyE']},
    {id:'line',label:'Line tool',description:'Draw a straight line.',defaults:['Digit4','KeyL']},
    {id:'arrow',label:'Arrow tool',description:'Draw an arrow annotation.',defaults:['Digit5','KeyA']},
    {id:'rect',label:'Rectangle tool',description:'Draw a rectangle.',defaults:['Digit6','KeyR']},
    {id:'circle',label:'Circle tool',description:'Draw a circle/ellipse.',defaults:['Digit7','KeyC']},
    {id:'highlight',label:'Highlight tool',description:'Use the current highlight mode.',defaults:['Digit8','KeyH']},
    {id:'cloud',label:'Revision cloud tool',description:'Draw a revision cloud.',defaults:['Digit9','KeyV']},
];
const SHORTCUT_ACTION_FIELDS=[
    {id:'copy',label:'Copy selection',description:'Copy the current selected annotation(s).',defaults:['Mod+KeyC']},
    {id:'cut',label:'Cut selection',description:'Copy and remove the current selection.',defaults:['Mod+KeyX']},
    {id:'paste',label:'Paste',description:'Paste the internal annotation clipboard onto the current page.',defaults:['Mod+KeyV']},
    {id:'selectAll',label:'Select all',description:'Select every annotation on the current page.',defaults:['Mod+KeyA']},
    {id:'duplicate',label:'Duplicate selection',description:'Duplicate the current selected annotation(s).',defaults:['Mod+KeyD']},
    {id:'save',label:'Save PDF',description:'Save even when focus is inside a field.',defaults:['Mod+KeyS']},
    {id:'undo',label:'Undo',description:'Undo the last change.',defaults:['Mod+KeyZ']},
    {id:'redo',label:'Redo',description:'Redo the next change.',defaults:['Mod+KeyY','Mod+Shift+KeyZ']},
    {id:'deleteSelection',label:'Delete selection',description:'Delete the active selected annotation(s).',defaults:['Delete','Backspace']},
    {id:'deselect',label:'Deselect / exit text edit',description:'Clear selection or exit active text editing.',defaults:['Escape']},
    {id:'zoomIn',label:'Zoom in',description:'Increase zoom level.',defaults:['Mod+Equal','Mod+Shift+Equal','Mod+NumpadAdd']},
    {id:'zoomOut',label:'Zoom out',description:'Decrease zoom level.',defaults:['Mod+Minus','Mod+NumpadSubtract']},
    {id:'zoomFit',label:'Zoom fit',description:'Return to fit-to-width zoom.',defaults:['Mod+Digit0','Mod+Numpad0']},
    {id:'nudgeLeft',label:'Nudge left',description:'Move selection left by 1 pixel.',defaults:['ArrowLeft']},
    {id:'nudgeRight',label:'Nudge right',description:'Move selection right by 1 pixel.',defaults:['ArrowRight']},
    {id:'nudgeUp',label:'Nudge up',description:'Move selection up by 1 pixel.',defaults:['ArrowUp']},
    {id:'nudgeDown',label:'Nudge down',description:'Move selection down by 1 pixel.',defaults:['ArrowDown']},
    {id:'nudgeLeftFast',label:'Nudge left x10',description:'Move selection left by 10 pixels.',defaults:['Shift+ArrowLeft']},
    {id:'nudgeRightFast',label:'Nudge right x10',description:'Move selection right by 10 pixels.',defaults:['Shift+ArrowRight']},
    {id:'nudgeUpFast',label:'Nudge up x10',description:'Move selection up by 10 pixels.',defaults:['Shift+ArrowUp']},
    {id:'nudgeDownFast',label:'Nudge down x10',description:'Move selection down by 10 pixels.',defaults:['Shift+ArrowDown']},
];
const SHORTCUT_REFERENCE_ACTION_IDS=['undo','redo','save','copy','cut','paste','selectAll','duplicate','deleteSelection','deselect','zoomIn','zoomOut','zoomFit','nudgeLeft','nudgeRight','nudgeUp','nudgeDown'];
const SHORTCUT_TOOL_FIELD_MAP=new Map(SHORTCUT_TOOL_FIELDS.map(def=>[def.id,def]));
const SHORTCUT_ACTION_FIELD_MAP=new Map(SHORTCUT_ACTION_FIELDS.map(def=>[def.id,def]));
const EDITOR_SETTINGS_SCHEMA_VERSION=1;
const SETTINGS_EXPORT_SCHEMA_VERSION=1;
const TOOLBAR_STATE_SCHEMA_VERSION=1;
const FONT_FAMILY_OPTIONS=['sans-serif','serif','monospace'];
const EDITOR_SETTINGS_LIMITS={
    maxStrokeSize:{min:6,max:200,default:DEFAULT_MAX_STROKE_SIZE},
    maxTextSize:{min:72,max:1000,default:DEFAULT_MAX_TEXT_SIZE}
};
let shortcutConfig=createDefaultShortcutConfig();
let shortcutDraftConfig=null;
let editorSettings=createDefaultEditorSettings();
let editorSettingsDraft=null;
let activeShortcutCapture=null;
let pendingShortcutResetNotice='';
let pendingEditorSettingsResetNotice='';
let pendingToolbarStateResetNotice='';
const shortcutLookup={tools:new Map(),actions:new Map()};

function createDefaultShortcutConfig(){
    const config={version:SHORTCUT_SCHEMA_VERSION,tools:{},actions:{}};
    SHORTCUT_TOOL_FIELDS.forEach(def=>{config.tools[def.id]=[...def.defaults];});
    SHORTCUT_ACTION_FIELDS.forEach(def=>{config.actions[def.id]=[...def.defaults];});
    return config;
}

function createDefaultEditorSettings(){
    return {
        version:EDITOR_SETTINGS_SCHEMA_VERSION,
        maxStrokeSize:EDITOR_SETTINGS_LIMITS.maxStrokeSize.default,
        maxTextSize:EDITOR_SETTINGS_LIMITS.maxTextSize.default
    };
}

function createDefaultToolbarState(){
    return {
        version:TOOLBAR_STATE_SCHEMA_VERSION,
        activeTool:'select',
        currentColor:'#ef4444',
        currentFontSize:16,
        currentStrokeWidth:3,
        currentFontFamily:'sans-serif',
        shapeFillEnabled:false,
        shapeFillOpacity:25
    };
}

function cloneShortcutConfig(config){
    return JSON.parse(JSON.stringify(config));
}

function cloneEditorSettings(settings){
    return JSON.parse(JSON.stringify(settings));
}

function cloneToolbarState(state){
    return JSON.parse(JSON.stringify(state));
}

function sanitizeShortcutBinding(binding){
    return typeof binding==='string'?binding.trim():'';
}

function normalizeToolbarColor(value){
    if(typeof value!=='string')return '';
    let color=value.trim().toLowerCase();
    if(!color)return '';
    if(/^#[0-9a-f]{3}$/.test(color)){
        color=`#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return /^#[0-9a-f]{6}$/.test(color)?color:'';
}

function mergeToolbarState(sourceState,{baseState=createDefaultToolbarState()}={}){
    const defaultState=createDefaultToolbarState();
    const safeBase=baseState&&typeof baseState==='object'?cloneToolbarState(baseState):defaultState;
    const source=sourceState&&typeof sourceState==='object'?sourceState:null;
    const normalized={...defaultState,...safeBase,version:TOOLBAR_STATE_SCHEMA_VERSION};
    let recognized=false;
    let mergedAny=!!(source&&source.version!==TOOLBAR_STATE_SCHEMA_VERSION);
    let ignoredCount=0;

    if(source&&Object.prototype.hasOwnProperty.call(source,'activeTool')){
        recognized=true;
        if(Object.prototype.hasOwnProperty.call(TOOL_NAMES,source.activeTool))normalized.activeTool=source.activeTool;
        else{ignoredCount++;mergedAny=true;}
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'currentColor')){
        recognized=true;
        const color=normalizeToolbarColor(source.currentColor);
        if(color)normalized.currentColor=color;
        else{ignoredCount++;mergedAny=true;}
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'currentFontSize')){
        recognized=true;
        const value=clampNumber(parseInt(source.currentFontSize,10)||0,8,maxTextSize);
        if(Number.isFinite(value)&&value>=8)normalized.currentFontSize=value;
        else{ignoredCount++;mergedAny=true;}
    }else{
        normalized.currentFontSize=clampNumber(parseInt(normalized.currentFontSize,10)||16,8,maxTextSize);
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'currentStrokeWidth')){
        recognized=true;
        const value=clampNumber(parseInt(source.currentStrokeWidth,10)||0,1,maxStrokeSize);
        if(Number.isFinite(value)&&value>=1)normalized.currentStrokeWidth=value;
        else{ignoredCount++;mergedAny=true;}
    }else{
        normalized.currentStrokeWidth=clampNumber(parseInt(normalized.currentStrokeWidth,10)||3,1,maxStrokeSize);
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'currentFontFamily')){
        recognized=true;
        if(FONT_FAMILY_OPTIONS.includes(source.currentFontFamily))normalized.currentFontFamily=source.currentFontFamily;
        else{ignoredCount++;mergedAny=true;}
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'shapeFillEnabled')){
        recognized=true;
        normalized.shapeFillEnabled=!!source.shapeFillEnabled;
        if(normalized.shapeFillEnabled!==source.shapeFillEnabled)mergedAny=true;
    }
    if(source&&Object.prototype.hasOwnProperty.call(source,'shapeFillOpacity')){
        recognized=true;
        const parsedValue=parseInt(source.shapeFillOpacity,10);
        if(Number.isInteger(parsedValue)){
            normalized.shapeFillOpacity=clampNumber(parsedValue,0,100);
            if(normalized.shapeFillOpacity!==parsedValue)mergedAny=true;
        }else{
            ignoredCount++;
            mergedAny=true;
        }
    }else{
        normalized.shapeFillOpacity=clampNumber(parseInt(normalized.shapeFillOpacity,10)||25,0,100);
    }

    normalized.currentFontSize=clampNumber(parseInt(normalized.currentFontSize,10)||16,8,maxTextSize);
    normalized.currentStrokeWidth=clampNumber(parseInt(normalized.currentStrokeWidth,10)||3,1,maxStrokeSize);
    normalized.shapeFillOpacity=clampNumber(parseInt(normalized.shapeFillOpacity,10)||25,0,100);
    if(!FONT_FAMILY_OPTIONS.includes(normalized.currentFontFamily))normalized.currentFontFamily='sans-serif';
    if(!Object.prototype.hasOwnProperty.call(TOOL_NAMES,normalized.activeTool))normalized.activeTool='select';
    const normalizedColor=normalizeToolbarColor(normalized.currentColor);
    normalized.currentColor=normalizedColor||'#ef4444';

    return {normalized,recognized,merged:mergedAny,ignoredCount};
}

function getShortcutBindingSourceArray(store,id){
    if(!store||typeof store!=='object'||!Object.prototype.hasOwnProperty.call(store,id))return null;
    const value=store[id];
    if(Array.isArray(value))return value.slice();
    if(typeof value==='string')return [value];
    return null;
}

function mergeShortcutConfig(sourceConfig,{baseConfig=createDefaultShortcutConfig()}={}){
    const safeBase=validateShortcutConfig(baseConfig).valid?cloneShortcutConfig(baseConfig):createDefaultShortcutConfig();
    const merged={version:SHORTCUT_SCHEMA_VERSION,tools:{},actions:{}};
    const source=sourceConfig&&typeof sourceConfig==='object'?sourceConfig:null;
    const seen=new Set();
    let recognized=false;
    let mergedAny=!!(source&&source.version!==SHORTCUT_SCHEMA_VERSION);
    let ignoredCount=0;

    [['tools',SHORTCUT_TOOL_FIELDS],['actions',SHORTCUT_ACTION_FIELDS]].forEach(([scope,defs])=>{
        const baseStore=safeBase[scope];
        const sourceStore=source&&source[scope]&&typeof source[scope]==='object'?source[scope]:null;
        merged[scope]={};
        defs.forEach(def=>{
            const baseBindings=getShortcutBindingSourceArray(baseStore,def.id)||[...def.defaults];
            const sourceBindings=getShortcutBindingSourceArray(sourceStore,def.id);
            if(sourceBindings){
                recognized=true;
                if(sourceBindings.length>def.defaults.length){
                    ignoredCount+=sourceBindings.length-def.defaults.length;
                    mergedAny=true;
                }
            }
            merged[scope][def.id]=def.defaults.map((defaultBinding,index)=>{
                const fallbackBinding=sanitizeShortcutBinding(baseBindings[index]!==undefined?baseBindings[index]:defaultBinding);
                if(sourceBindings&&index<sourceBindings.length){
                    const candidateBinding=sanitizeShortcutBinding(sourceBindings[index]);
                    if(candidateBinding===''){
                        if(candidateBinding!==fallbackBinding)mergedAny=true;
                        return '';
                    }
                    if(isShortcutBindingValid(candidateBinding)&&!seen.has(candidateBinding)){
                        if(candidateBinding!==fallbackBinding)mergedAny=true;
                        seen.add(candidateBinding);
                        return candidateBinding;
                    }
                    ignoredCount++;
                    mergedAny=true;
                }
                if(fallbackBinding&&isShortcutBindingValid(fallbackBinding)&&!seen.has(fallbackBinding)){
                    seen.add(fallbackBinding);
                    return fallbackBinding;
                }
                if(fallbackBinding)mergedAny=true;
                return '';
            });
        });
    });

    return {normalized:merged,recognized,merged:mergedAny,ignoredCount};
}

function mergeEditorSettings(sourceSettings,{baseSettings=createDefaultEditorSettings()}={}){
    const baseValidation=validateEditorSettings(baseSettings);
    const safeBase=baseValidation.valid?cloneEditorSettings(baseValidation.normalized):createDefaultEditorSettings();
    const source=sourceSettings&&typeof sourceSettings==='object'?sourceSettings:null;
    const merged={version:EDITOR_SETTINGS_SCHEMA_VERSION};
    let recognized=false;
    let mergedAny=!!(source&&source.version!==EDITOR_SETTINGS_SCHEMA_VERSION);
    let ignoredCount=0;

    Object.entries(EDITOR_SETTINGS_LIMITS).forEach(([key,limits])=>{
        merged[key]=safeBase[key];
        if(!source||!Object.prototype.hasOwnProperty.call(source,key))return;
        recognized=true;
        const parsedValue=parseInt(source[key],10);
        if(Number.isInteger(parsedValue)&&parsedValue>=limits.min&&parsedValue<=limits.max){
            if(parsedValue!==safeBase[key])mergedAny=true;
            merged[key]=parsedValue;
            return;
        }
        ignoredCount++;
        mergedAny=true;
    });

    return {normalized:merged,recognized,merged:mergedAny,ignoredCount};
}

function getShortcutFieldDefinitions(scope){
    return scope==='tools'?SHORTCUT_TOOL_FIELDS:SHORTCUT_ACTION_FIELDS;
}

function getShortcutFieldDefinition(scope,id){
    return (scope==='tools'?SHORTCUT_TOOL_FIELD_MAP:SHORTCUT_ACTION_FIELD_MAP).get(id)||null;
}

function getShortcutFieldLabel(scope,id){
    const def=getShortcutFieldDefinition(scope,id);
    return def?def.label:id;
}

function getShortcutBindings(scope,id,sourceConfig=shortcutConfig){
    const store=scope==='tools'?sourceConfig.tools:sourceConfig.actions;
    const bindings=store&&Array.isArray(store[id])?store[id]:[];
    return bindings.slice();
}

function getFirstShortcutBinding(scope,id,sourceConfig=shortcutConfig){
    return getShortcutBindings(scope,id,sourceConfig).find(Boolean)||'';
}

function isShortcutBindingValid(binding){
    if(binding==='')return true;
    if(typeof binding!=='string')return false;
    const parts=binding.split('+').filter(Boolean);
    if(parts.length===0)return false;
    const code=parts[parts.length-1];
    const modifiers=parts.slice(0,-1);
    if(!code||SHORTCUT_MODIFIER_CODES.has(code))return false;
    if(new Set(modifiers).size!==modifiers.length)return false;
    return modifiers.every(part=>part==='Mod'||part==='Alt'||part==='Shift');
}

function iterateShortcutBindings(config,visitor){
    [['tools',SHORTCUT_TOOL_FIELDS],['actions',SHORTCUT_ACTION_FIELDS]].forEach(([scope,defs])=>{
        defs.forEach(def=>{
            const bindings=getShortcutBindings(scope,def.id,config);
            def.defaults.forEach((_,index)=>{
                visitor({scope,id:def.id,definition:def,index,binding:bindings[index]||''});
            });
        });
    });
}

function validateShortcutConfig(config){
    if(!config||config.version!==SHORTCUT_SCHEMA_VERSION)return {valid:false,reason:'version'};
    if(!config.tools||!config.actions)return {valid:false,reason:'shape'};
    if(Object.keys(config.tools).length!==SHORTCUT_TOOL_FIELDS.length)return {valid:false,reason:'tools'};
    if(Object.keys(config.actions).length!==SHORTCUT_ACTION_FIELDS.length)return {valid:false,reason:'actions'};
    const seen=new Map();
    let invalidReason='';
    iterateShortcutBindings(config,entry=>{
        if(invalidReason)return;
        const expectedLength=entry.definition.defaults.length;
        const store=entry.scope==='tools'?config.tools:config.actions;
        if(!Array.isArray(store[entry.id])||store[entry.id].length!==expectedLength){
            invalidReason='slots';
            return;
        }
        if(!isShortcutBindingValid(entry.binding)){
            invalidReason='binding';
            return;
        }
        if(entry.binding){
            if(seen.has(entry.binding)){
                invalidReason='duplicate';
                return;
            }
            seen.set(entry.binding,entry);
        }
    });
    return invalidReason?{valid:false,reason:invalidReason}:{valid:true};
}

function validateEditorSettings(settings){
    if(!settings||settings.version!==EDITOR_SETTINGS_SCHEMA_VERSION)return {valid:false,reason:'version'};
    const maxStrokeSizeValue=parseInt(settings.maxStrokeSize,10);
    const maxTextSizeValue=parseInt(settings.maxTextSize,10);
    if(!Number.isInteger(maxStrokeSizeValue)||maxStrokeSizeValue<EDITOR_SETTINGS_LIMITS.maxStrokeSize.min||maxStrokeSizeValue>EDITOR_SETTINGS_LIMITS.maxStrokeSize.max){
        return {valid:false,reason:'maxStrokeSize'};
    }
    if(!Number.isInteger(maxTextSizeValue)||maxTextSizeValue<EDITOR_SETTINGS_LIMITS.maxTextSize.min||maxTextSizeValue>EDITOR_SETTINGS_LIMITS.maxTextSize.max){
        return {valid:false,reason:'maxTextSize'};
    }
    return {
        valid:true,
        normalized:{
            version:EDITOR_SETTINGS_SCHEMA_VERSION,
            maxStrokeSize:maxStrokeSizeValue,
            maxTextSize:maxTextSizeValue
        }
    };
}

function findShortcutConflict(config,binding,excludeEntry=null){
    let found=null;
    iterateShortcutBindings(config,entry=>{
        if(found||!entry.binding||entry.binding!==binding)return;
        if(excludeEntry&&excludeEntry.scope===entry.scope&&excludeEntry.id===entry.id&&excludeEntry.index===entry.index)return;
        found=entry;
    });
    return found;
}

function serializeShortcutFromEvent(e){
    if(!e||!e.code||SHORTCUT_MODIFIER_CODES.has(e.code))return '';
    const parts=[];
    if(e.ctrlKey||e.metaKey)parts.push('Mod');
    if(e.altKey)parts.push('Alt');
    if(e.shiftKey)parts.push('Shift');
    parts.push(e.code);
    return parts.join('+');
}

function formatShortcutCode(code,compact=false){
    const labels={
        Backspace:compact?'Bksp':'Backspace',
        Delete:compact?'Del':'Delete',
        Escape:'Esc',
        Equal:'=',
        Minus:'-',
        Space:compact?'Space':'Space',
        ArrowLeft:compact?'Left':'Left Arrow',
        ArrowRight:compact?'Right':'Right Arrow',
        ArrowUp:compact?'Up':'Up Arrow',
        ArrowDown:compact?'Down':'Down Arrow',
        NumpadAdd:compact?'Num+':'Numpad +',
        NumpadSubtract:compact?'Num-':'Numpad -',
        Numpad0:compact?'Num0':'Numpad 0',
        Backquote:'`',
        BracketLeft:'[',
        BracketRight:']',
        Semicolon:';',
        Quote:"'",
        Comma:',',
        Period:'.',
        Slash:'/',
        Backslash:'\\'
    };
    if(labels[code])return labels[code];
    if(/^Key[A-Z]$/.test(code))return code.slice(3);
    if(/^Digit[0-9]$/.test(code))return code.slice(5);
    if(/^Numpad[0-9]$/.test(code))return compact?`Num${code.slice(6)}`:`Numpad ${code.slice(6)}`;
    if(/^F\d{1,2}$/.test(code))return code;
    return code.replace(/^Numpad/,'Numpad ').replace(/([a-z])([A-Z])/g,'$1 $2');
}

function formatShortcutBinding(binding,{compact=false}={}){
    if(!binding)return compact?'':'Unassigned';
    const parts=binding.split('+');
    const code=parts.pop();
    const modifierLabels=parts.map(part=>{
        if(part==='Mod')return compact?'Mod':'Ctrl/Command';
        if(part==='Alt')return 'Alt';
        if(part==='Shift')return 'Shift';
        return part;
    });
    return [...modifierLabels,formatShortcutCode(code,compact)].join(compact?'+':' + ');
}

function formatToolBadge(bindings){
    const compactBindings=bindings.filter(Boolean).slice(0,2).map(binding=>formatShortcutBinding(binding,{compact:true}));
    if(compactBindings.length===0)return '';
    const joined=compactBindings.join('/');
    return joined.length<=9?joined:compactBindings[0];
}

function escapeHtml(str){
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

function rebuildShortcutLookup(){
    shortcutLookup.tools.clear();
    shortcutLookup.actions.clear();
    SHORTCUT_TOOL_FIELDS.forEach(def=>{
        getShortcutBindings('tools',def.id).forEach(binding=>{
            if(binding)shortcutLookup.tools.set(binding,def.id);
        });
    });
    SHORTCUT_ACTION_FIELDS.forEach(def=>{
        getShortcutBindings('actions',def.id).forEach(binding=>{
            if(binding)shortcutLookup.actions.set(binding,def.id);
        });
    });
}

function updateToolButtonShortcutHints(){
    SHORTCUT_TOOL_FIELDS.forEach(def=>{
        const button=document.querySelector(`.tool-btn[data-tool="${def.id}"]`);
        if(!button)return;
        const bindings=getShortcutBindings('tools',def.id);
        const label=formatToolBadge(bindings);
        const titleBindings=bindings.filter(Boolean).map(binding=>formatShortcutBinding(binding)).join(' / ');
        const keyEl=button.querySelector('.tool-key');
        if(keyEl)keyEl.textContent=label;
        button.title=titleBindings?`${TOOL_NAMES[def.id]} (${titleBindings})`:TOOL_NAMES[def.id];
    });
}

function renderShortcutReference(){
    if(!shortcutReferenceList)return;
    const toolItems=SHORTCUT_TOOL_FIELDS.map(def=>{
        const bindings=getShortcutBindings('tools',def.id).filter(Boolean).map(binding=>formatShortcutBinding(binding,{compact:true})).join(' / ');
        return `<span><b>${escapeHtml(bindings||'--')}</b> ${escapeHtml(TOOL_NAMES[def.id])}</span>`;
    });
    const actionItems=SHORTCUT_REFERENCE_ACTION_IDS.map(id=>{
        const def=getShortcutFieldDefinition('actions',id);
        const bindings=getShortcutBindings('actions',id).filter(Boolean).map(binding=>formatShortcutBinding(binding)).join(' / ');
        return `<span class="shortcut-reference-full"><b>${escapeHtml(bindings||'Unassigned')}</b> ${escapeHtml(def.label)}</span>`;
    });
    shortcutReferenceList.innerHTML=[...toolItems,...actionItems].join('');
}

function updateShortcutDependentTitles(){
    const actionTitle=(id,fallback)=>getShortcutBindings('actions',id).filter(Boolean).map(binding=>formatShortcutBinding(binding)).join(' / ')||fallback;
    if(btnUndo)btnUndo.title=`Undo (${actionTitle('undo','Unassigned')})`;
    if(btnRedo)btnRedo.title=`Redo (${actionTitle('redo','Unassigned')})`;
    if(btnSavePdf)btnSavePdf.title=`Save PDF (${actionTitle('save','Unassigned')})`;
    if(btnShortcutSettings)btnShortcutSettings.title='Settings';
}

function renderInitialShortcutHint(){
    if(!initialShortcutHint)return;
    const saveHint=formatShortcutBinding(getFirstShortcutBinding('actions','save'));
    const undoHint=formatShortcutBinding(getFirstShortcutBinding('actions','undo'));
    const redoHint=formatShortcutBinding(getFirstShortcutBinding('actions','redo'));
    initialShortcutHint.textContent=`Shortcuts are customizable in Settings. Save: ${saveHint} | Undo: ${undoHint} | Redo: ${redoHint}`;
}

function refreshShortcutUI(){
    updateToolButtonShortcutHints();
    renderShortcutReference();
    updateShortcutDependentTitles();
    renderInitialShortcutHint();
}

function getCurrentEditorSettings(){
    return cloneEditorSettings(editorSettings);
}

function persistEditorSettings(){
    try{localStorage.setItem(PREF_KEY_EDITOR_SETTINGS,JSON.stringify(getCurrentEditorSettings()));}catch(e){}

}

function applyEditorSettings(settings,{persist=false}={}){
    editorSettings=cloneEditorSettings(settings);
    maxStrokeSize=editorSettings.maxStrokeSize;
    maxTextSize=editorSettings.maxTextSize;
    currentStrokeWidth=clampNumber(currentStrokeWidth,1,maxStrokeSize);
    currentFontSize=clampNumber(currentFontSize,8,maxTextSize);
    if(activeTool==='draw'){
        fabricCanvases.forEach(c=>{if(c.freeDrawingBrush)c.freeDrawingBrush.width=currentStrokeWidth;});
    }else if(activeTool==='highlight'&&highlightMode==='pen'){
        fabricCanvases.forEach(c=>{if(c.freeDrawingBrush)c.freeDrawingBrush.width=getHighlightBrushWidth();});
    }
    syncSizeControl();
    persistToolbarPreference();
    if(persist)persistEditorSettings();
}

function getCurrentShortcutConfig(){
    return cloneShortcutConfig(shortcutConfig);
}

function persistShortcutPreference(){
    try{localStorage.setItem(PREF_KEY_SHORTCUTS,JSON.stringify(getCurrentShortcutConfig()));}catch(e){}
}

function applyShortcutConfig(config,{persist=false}={}){
    shortcutConfig=cloneShortcutConfig(config);
    rebuildShortcutLookup();
    refreshShortcutUI();
    if(persist)persistShortcutPreference();
}

function loadShortcutPreference(){
    let parsedConfig=null;
    try{
        const raw=localStorage.getItem(PREF_KEY_SHORTCUTS);
        if(raw)parsedConfig=JSON.parse(raw);
    }catch(e){}
    const mergeResult=mergeShortcutConfig(parsedConfig,{baseConfig:createDefaultShortcutConfig()});
    applyShortcutConfig(mergeResult.normalized,{persist:true});
    if(parsedConfig&&(!mergeResult.recognized||mergeResult.merged||mergeResult.ignoredCount>0)){
        pendingShortcutResetNotice='Shortcut settings were merged with the latest defaults. Unknown or conflicting entries were ignored.';
    }
}

function loadEditorSettings(){
    let parsedSettings=null;
    try{
        const raw=localStorage.getItem(PREF_KEY_EDITOR_SETTINGS);
        if(raw)parsedSettings=JSON.parse(raw);
    }catch(e){}
    const mergeResult=mergeEditorSettings(parsedSettings,{baseSettings:createDefaultEditorSettings()});
    applyEditorSettings(mergeResult.normalized,{persist:true});
    if(parsedSettings&&(!mergeResult.recognized||mergeResult.merged||mergeResult.ignoredCount>0)){
        pendingEditorSettingsResetNotice='Editor limits were merged with the latest defaults. Unknown or invalid values were ignored.';
    }
}

function getCurrentToolbarState(){
    return cloneToolbarState({
        version:TOOLBAR_STATE_SCHEMA_VERSION,
        activeTool,
        currentColor,
        currentFontSize:clampNumber(parseInt(currentFontSize,10)||16,8,maxTextSize),
        currentStrokeWidth:clampNumber(parseInt(currentStrokeWidth,10)||3,1,maxStrokeSize),
        currentFontFamily:FONT_FAMILY_OPTIONS.includes(currentFontFamily)?currentFontFamily:'sans-serif',
        shapeFillEnabled:!!shapeFillEnabled,
        shapeFillOpacity:clampNumber(parseInt(shapeFillOpacity,10)||25,0,100)
    });
}

function persistToolbarPreference(){
    try{localStorage.setItem(PREF_KEY_TOOLBAR_STATE,JSON.stringify(getCurrentToolbarState()));}catch(e){}
}

function applyToolbarPreference(state,{persist=false}={}){
    const normalized=mergeToolbarState(state,{baseState:getCurrentToolbarState()}).normalized;
    activeTool=normalized.activeTool;
    currentColor=normalized.currentColor;
    currentFontSize=normalized.currentFontSize;
    currentStrokeWidth=normalized.currentStrokeWidth;
    currentFontFamily=normalized.currentFontFamily;
    shapeFillEnabled=normalized.shapeFillEnabled;
    shapeFillOpacity=normalized.shapeFillOpacity;
    if(fontFamilySelect)fontFamilySelect.value=currentFontFamily;
    if(fillToggle)fillToggle.checked=shapeFillEnabled;
    if(fillOpacitySlider){
        fillOpacitySlider.value=shapeFillOpacity;
        fillOpacitySlider.disabled=!shapeFillEnabled;
    }
    if(fillOpacityNumber){
        fillOpacityNumber.value=shapeFillOpacity;
        fillOpacityNumber.disabled=!shapeFillEnabled;
    }
    if(persist)persistToolbarPreference();
}

function loadToolbarPreference(){
    let parsedState=null;
    try{
        const raw=localStorage.getItem(PREF_KEY_TOOLBAR_STATE);
        if(raw)parsedState=JSON.parse(raw);
    }catch(e){}
    const mergeResult=mergeToolbarState(parsedState,{baseState:createDefaultToolbarState()});
    applyToolbarPreference(mergeResult.normalized,{persist:true});
    if(parsedState&&(!mergeResult.recognized||mergeResult.merged||mergeResult.ignoredCount>0)){
        pendingToolbarStateResetNotice='Last-used toolbar state was merged with supported fields. Unknown or invalid values were ignored.';
    }
}

function getSettingsExportSnapshot({preferDraft=true}={}){
    return {
        shortcutConfig:preferDraft&&shortcutDraftConfig?cloneShortcutConfig(shortcutDraftConfig):getCurrentShortcutConfig(),
        editorSettings:preferDraft&&editorSettingsDraft?cloneEditorSettings(editorSettingsDraft):getCurrentEditorSettings()
    };
}

function createSettingsExportPayload({preferDraft=true}={}){
    const snapshot=getSettingsExportSnapshot({preferDraft});
    return {
        app:'DraftAnnotator',
        type:'settings-export',
        version:SETTINGS_EXPORT_SCHEMA_VERSION,
        exportedAt:new Date().toISOString(),
        shortcutConfig:snapshot.shortcutConfig,
        editorSettings:snapshot.editorSettings
    };
}

function getSettingsExportFileStem(){
    const now=new Date();
    const parts=[
        now.getFullYear(),
        String(now.getMonth()+1).padStart(2,'0'),
        String(now.getDate()).padStart(2,'0'),
        '-',
        String(now.getHours()).padStart(2,'0'),
        String(now.getMinutes()).padStart(2,'0'),
        String(now.getSeconds()).padStart(2,'0')
    ];
    return `draftannotator-settings-${parts.join('')}`;
}

function downloadTextFile(filename,text,mimeType){
    const blob=new Blob([text],{type:mimeType});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function escapeCsvValue(value){
    const text=String(value??'');
    return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}

function createSettingsCsvText({preferDraft=true}={}){
    const snapshot=getSettingsExportSnapshot({preferDraft});
    const rows=[['section','id','slot','value']];
    SHORTCUT_TOOL_FIELDS.forEach(def=>{
        const bindings=getShortcutBindings('tools',def.id,snapshot.shortcutConfig);
        def.defaults.forEach((_,index)=>{
            rows.push(['tools',def.id,String(index+1),bindings[index]||'']);
        });
    });
    SHORTCUT_ACTION_FIELDS.forEach(def=>{
        const bindings=getShortcutBindings('actions',def.id,snapshot.shortcutConfig);
        def.defaults.forEach((_,index)=>{
            rows.push(['actions',def.id,String(index+1),bindings[index]||'']);
        });
    });
    Object.keys(EDITOR_SETTINGS_LIMITS).forEach(key=>{
        rows.push(['editor',key,'',String(snapshot.editorSettings[key]??'')]);
    });
    return rows.map(row=>row.map(escapeCsvValue).join(',')).join('\r\n');
}

function exportSettingsAsJson(){
    const filename=`${getSettingsExportFileStem()}.json`;
    const payload=createSettingsExportPayload();
    downloadTextFile(filename,JSON.stringify(payload,null,2),'application/json;charset=utf-8');
    setShortcutSettingsStatus('JSON settings exported.','success');
}

function exportSettingsAsCsv(){
    const filename=`${getSettingsExportFileStem()}.csv`;
    downloadTextFile(filename,createSettingsCsvText(),'text/csv;charset=utf-8');
    setShortcutSettingsStatus('CSV settings exported.','success');
}

function parseCsvRows(text){
    const rows=[];
    let row=[];
    let value='';
    let inQuotes=false;
    const input=(text||'').replace(/^\uFEFF/,'');
    for(let i=0;i<input.length;i++){
        const ch=input[i];
        if(inQuotes){
            if(ch==='"'){
                if(input[i+1]==='"'){
                    value+='"';
                    i++;
                }else{
                    inQuotes=false;
                }
            }else{
                value+=ch;
            }
            continue;
        }
        if(ch==='"'){
            inQuotes=true;
            continue;
        }
        if(ch===','){
            row.push(value);
            value='';
            continue;
        }
        if(ch==='\r'||ch==='\n'){
            if(ch==='\r'&&input[i+1]==='\n')i++;
            row.push(value);
            const hasContent=row.some(cell=>String(cell).trim()!=='');
            if(hasContent)rows.push(row);
            row=[];
            value='';
            continue;
        }
        value+=ch;
    }
    row.push(value);
    if(row.some(cell=>String(cell).trim()!==''))rows.push(row);
    return rows;
}

function extractShortcutConfigFromObject(source){
    if(!source||typeof source!=='object')return null;
    const root=source.settings&&typeof source.settings==='object'?source.settings:source;
    if(root.shortcutConfig&&typeof root.shortcutConfig==='object')return root.shortcutConfig;
    if(root.shortcuts&&typeof root.shortcuts==='object')return root.shortcuts;
    if((root.tools&&typeof root.tools==='object')||(root.actions&&typeof root.actions==='object'))return root;
    return null;
}

function extractEditorSettingsFromObject(source){
    if(!source||typeof source!=='object')return null;
    const root=source.settings&&typeof source.settings==='object'?source.settings:source;
    if(root.editorSettings&&typeof root.editorSettings==='object')return root.editorSettings;
    if(root.editor&&typeof root.editor==='object')return root.editor;
    if(root.limits&&typeof root.limits==='object')return root.limits;
    if(Object.keys(EDITOR_SETTINGS_LIMITS).some(key=>Object.prototype.hasOwnProperty.call(root,key)))return root;
    return null;
}

function parseSettingsJsonText(text){
    let parsed;
    try{
        parsed=JSON.parse(text);
    }catch(e){
        throw new Error('JSON settings file could not be parsed.');
    }
    const shortcutConfig=extractShortcutConfigFromObject(parsed);
    const editorSettings=extractEditorSettingsFromObject(parsed);
    return {
        shortcutConfig,
        editorSettings,
        hasShortcutData:!!shortcutConfig,
        hasEditorData:!!editorSettings
    };
}

function parseSettingsCsvText(text){
    const rows=parseCsvRows(text);
    if(rows.length<2)throw new Error('CSV settings file is empty.');
    const header=rows[0].map(cell=>String(cell||'').trim().toLowerCase());
    const sectionIndex=header.findIndex(cell=>['section','scope','type','category'].includes(cell));
    const idIndex=header.findIndex(cell=>['id','key','name'].includes(cell));
    const slotIndex=header.findIndex(cell=>['slot','index','position'].includes(cell));
    const valueIndex=header.findIndex(cell=>['value','binding','setting'].includes(cell));
    if(sectionIndex<0||idIndex<0||valueIndex<0)throw new Error('CSV settings need section, id, and value columns.');

    const shortcutConfig={tools:{},actions:{}};
    const editorSettings={};
    let hasShortcutData=false;
    let hasEditorData=false;

    rows.slice(1).forEach(row=>{
        const section=String(row[sectionIndex]||'').trim().toLowerCase();
        const id=String(row[idIndex]||'').trim();
        const value=row[valueIndex]!==undefined?String(row[valueIndex]).trim():'';
        const slotValue=slotIndex>=0?String(row[slotIndex]||'').trim():'';
        if(!section||!id)return;
        if(section==='tools'||section==='tool'){
            const slot=Math.max(0,(parseInt(slotValue,10)||1)-1);
            if(!Array.isArray(shortcutConfig.tools[id]))shortcutConfig.tools[id]=[];
            shortcutConfig.tools[id][slot]=value;
            hasShortcutData=true;
            return;
        }
        if(section==='actions'||section==='action'){
            const slot=Math.max(0,(parseInt(slotValue,10)||1)-1);
            if(!Array.isArray(shortcutConfig.actions[id]))shortcutConfig.actions[id]=[];
            shortcutConfig.actions[id][slot]=value;
            hasShortcutData=true;
            return;
        }
        if(section==='editor'||section==='setting'||section==='settings'){
            editorSettings[id]=value;
            hasEditorData=true;
        }
    });

    return {
        shortcutConfig:hasShortcutData?shortcutConfig:null,
        editorSettings:hasEditorData?editorSettings:null,
        hasShortcutData,
        hasEditorData
    };
}

function parseImportedSettingsText(text,fileName=''){
    const normalizedName=(fileName||'').toLowerCase();
    if(normalizedName.endsWith('.csv'))return parseSettingsCsvText(text);
    if(normalizedName.endsWith('.json'))return parseSettingsJsonText(text);
    const trimmed=(text||'').trim();
    return trimmed.startsWith('{')?parseSettingsJsonText(text):parseSettingsCsvText(text);
}

function applyImportedSettingsPayload(payload){
    const baseShortcutConfig=shortcutDraftConfig?cloneShortcutConfig(shortcutDraftConfig):getCurrentShortcutConfig();
    const baseEditorSettings=editorSettingsDraft?cloneEditorSettings(editorSettingsDraft):getCurrentEditorSettings();
    const shortcutMerge=payload&&payload.shortcutConfig
        ? mergeShortcutConfig(payload.shortcutConfig,{baseConfig:baseShortcutConfig})
        : {recognized:false,merged:false,ignoredCount:0,normalized:baseShortcutConfig};
    const editorMerge=payload&&payload.editorSettings
        ? mergeEditorSettings(payload.editorSettings,{baseSettings:baseEditorSettings})
        : {recognized:false,merged:false,ignoredCount:0,normalized:baseEditorSettings};

    if(!shortcutMerge.recognized&&!editorMerge.recognized){
        throw new Error('No supported settings were found in that file.');
    }

    activeShortcutCapture=null;
    if(shortcutMerge.recognized){
        shortcutDraftConfig=cloneShortcutConfig(shortcutMerge.normalized);
        applyShortcutConfig(shortcutMerge.normalized,{persist:true});
    }
    if(editorMerge.recognized){
        editorSettingsDraft=cloneEditorSettings(editorMerge.normalized);
        applyEditorSettings(editorMerge.normalized,{persist:true});
    }
    renderShortcutSettings();
    renderEditorSettingsDraft();
    const ignoredCount=(shortcutMerge.ignoredCount||0)+(editorMerge.ignoredCount||0);
    const mergedNotice=shortcutMerge.merged||editorMerge.merged||ignoredCount>0
        ? ' Settings were merged with current known fields and unsupported entries were ignored.'
        : '';
    setShortcutSettingsStatus(`Settings imported and saved.${mergedNotice}`,ignoredCount>0?'info':'success');
    showMsg(ignoredCount>0?'Settings imported with cleanup':'Settings imported');
}

async function importSettingsFromFile(file){
    if(!file)return;
    if(file.size>2*1024*1024)throw new Error('Settings file is too large (2 MB maximum).');
    const text=await file.text();
    const payload=parseImportedSettingsText(text,file.name||'');
    applyImportedSettingsPayload(payload);
}

// The single Arrow dropdown encodes both the style (single/double/note) and,
// for note mode, which end the text sits on. Map between that combined value
// and the underlying arrowMode + arrowNoteSide state (persisted separately so
// older saved prefs still load).
function getArrowSelectValue(){
    if(arrowMode==='note')return arrowNoteSide==='tail'?'note-tail':'note-head';
    return arrowMode;
}

function applyArrowSelectValue(value){
    if(value==='note-head'){arrowMode='note';arrowNoteSide='head';return true;}
    if(value==='note-tail'){arrowMode='note';arrowNoteSide='tail';return true;}
    if(value==='single'||value==='double'){arrowMode=value;return true;}
    return false;
}

function loadArrowModePreference(){
    try{
        const saved=localStorage.getItem(PREF_KEY_ARROW_MODE);
        if(saved&&ARROW_MODE_OPTIONS.includes(saved))arrowMode=saved;
    }catch(e){}
    try{
        const savedSide=localStorage.getItem(PREF_KEY_ARROW_NOTE_SIDE);
        if(savedSide&&ARROW_NOTE_SIDE_OPTIONS.includes(savedSide))arrowNoteSide=savedSide;
    }catch(e){}
    if(arrowModeSelect)arrowModeSelect.value=getArrowSelectValue();
}

function persistArrowModePreference(){
    try{localStorage.setItem(PREF_KEY_ARROW_MODE,arrowMode);}catch(e){}
}

function persistArrowNoteSidePreference(){
    try{localStorage.setItem(PREF_KEY_ARROW_NOTE_SIDE,arrowNoteSide);}catch(e){}
}

function loadHighlightModePreference(){
    try{
        const saved=localStorage.getItem(PREF_KEY_HIGHLIGHT_MODE);
        if(saved&&HIGHLIGHT_MODE_OPTIONS.includes(saved))highlightMode=saved;
    }catch(e){}
    if(highlightModeSelect)highlightModeSelect.value=highlightMode;
}

function persistHighlightModePreference(){
    try{localStorage.setItem(PREF_KEY_HIGHLIGHT_MODE,highlightMode);}catch(e){}
}


// ─── HISTORY SYSTEM ─────────────────────────────────
function getSerializedCanvasState(c){
    return JSON.stringify(getCanvasJsonWithAnnotationMetadata(c));
}

function getCanvasJsonWithAnnotationMetadata(canvas){
    const json=canvas.toJSON(SERIALIZED_ANNOTATION_PROPS);
    const objects=canvas.getObjects();
    if(!Array.isArray(json.objects))json.objects=[];
    window.EmbeddedAnnotationUtils.copyObjectMetadata(
        json.objects,objects,SERIALIZED_ANNOTATION_PROPS);
    return json;
}

function copySerializedAnnotationMetadata(source,target){
    if(!source||!target)return target;
    SERIALIZED_ANNOTATION_PROPS.forEach(property=>{
        if(source[property]!==undefined)target[property]=source[property];
    });
    return target;
}

let draftAnnotationIdSequence=0;
function createDraftAnnotationId(){
    if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();
    draftAnnotationIdSequence+=1;
    return `${Date.now().toString(36)}-${draftAnnotationIdSequence.toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

function ensureDraftAnnotationId(object){
    if(!object)return '';
    if(!object.draftAnnotationId)object.draftAnnotationId=createDraftAnnotationId();
    return object.draftAnnotationId;
}

function ensureUniqueDraftAnnotationId(object,usedIds){
    let id=ensureDraftAnnotationId(object);
    if(usedIds&&usedIds.has(id)){
        object.draftAnnotationId=createDraftAnnotationId();
        id=object.draftAnnotationId;
    }
    if(usedIds)usedIds.add(id);
    return id;
}

function syncPendingTextEdits(){
    hasPendingTextEdits=false;
    for(const c of fabricCanvases.values()){
        for(const o of c.getObjects()){
            if(isTextObject(o)&&o.isEditing){
                hasPendingTextEdits=true;
                return;
            }
        }
    }
}

function recomputeUnsavedChanges(){
    syncPendingTextEdits();
    if(hasPendingTextEdits){hasUnsavedChanges=true;return;}
    for(const [pn,c] of fabricCanvases){
        const savedState=savedStateByPage.get(pn);
        if(savedState===undefined)continue;
        // Compare against last known state to avoid full re-serialization
        if(c._lastSavedState!==undefined&&c._lastSavedState!==savedState){
            hasUnsavedChanges=true;
            return;
        }
    }
    hasUnsavedChanges=false;
}

const MAX_HISTORY=200;
const MAX_HISTORY_BYTES=50*1024*1024;
let historyRestoreInProgress=false;
let historyTotalBytes=0;
function pushHistoryEntry(pageNum,state){
    const removedRedo=historyStack.splice(historyPointer+1);
    removedRedo.forEach(entry=>{historyTotalBytes-=entry.bytes||0;});
    const bytes=String(state||'').length*2;
    historyStack.push({pageNum,state,bytes});
    historyTotalBytes+=bytes;
    while(historyStack.length>2&&(historyStack.length>MAX_HISTORY||historyTotalBytes>MAX_HISTORY_BYTES)){
        const removed=historyStack.shift();
        historyTotalBytes-=removed.bytes||0;
    }
    historyPointer=historyStack.length-1;
}

function saveCanvasState(c){
    if(c._restoring||c._suppressHistory) return;
    const state=getSerializedCanvasState(c);
    if(!c._historySeeded){
        pushHistoryEntry(c._pageNum,c._lastSavedState||state);
        c._historySeeded=true;
    }
    if(historyStack[historyPointer]?.state===state){
        c._lastSavedState=state;
        recomputeUnsavedChanges();
        return;
    }
    pushHistoryEntry(c._pageNum,state);
    c._lastSavedState=state;
    recomputeUnsavedChanges();
}

// DraftAnnotator stores this validated Fabric package inside each saved PDF.
// Standard annotations provide interoperability; this package preserves the
// exact Fabric objects when the PDF is reopened here.
const ANNOTATION_FORMAT='draftannotator.annotations';
const ANNOTATION_FORMAT_VERSION=1;

function annotationPageSize(canvas){
    const vpt=canvas.viewportTransform||[1,0,0,1,0,0];
    return {width:canvas.width/(vpt[0]||1),height:canvas.height/(vpt[3]||1)};
}

async function materializePendingAnnotations(){
    const pendingPages=Array.from(new Set([
        ...pendingDraftPageAnnotations.keys(),
        ...pendingEmbeddedPageAnnotations.keys()
    ])).sort((a,b)=>a-b);
    for(const pageNumber of pendingPages)await ensureAnnotationPageRendered(pageNumber);
}

async function createAnnotationPackage(nativeDescriptors=[]){
    await materializePendingAnnotations();
    const pages=[];
    fabricCanvases.forEach((canvas,pageNumber)=>{
        const size=annotationPageSize(canvas);
        const json=getCanvasJsonWithAnnotationMetadata(canvas);
        if(json.objects&&json.objects.length){
            pages.push({pageNumber,width:size.width,height:size.height,fabric:json});
        }
    });
    return {
        format:ANNOTATION_FORMAT,
        version:ANNOTATION_FORMAT_VERSION,
        source:{fileName:currentFileName||'',pageCount:numPages},
        pages,
        nativeAnnotations:{
            version:window.NativeAnnotationUtils.NATIVE_FORMAT_VERSION,
            descriptors:nativeDescriptors.map(nativeDescriptorSnapshot)
        }
    };
}

function ensureAnnotationPackage(value){
    if(!value||value.format!==ANNOTATION_FORMAT||value.version!==ANNOTATION_FORMAT_VERSION||!Array.isArray(value.pages)){
        throw new Error('Unsupported or invalid embedded annotation data.');
    }
    if(value.pages.length>10000)throw new Error('Embedded annotation data contains too many pages.');
    const seenPages=new Set();
    const sourcePageCount=Number(value.source&&value.source.pageCount);
    value.pages.forEach(page=>{
        const pageNumber=Number(page&&page.pageNumber);
        const width=Number(page&&page.width),height=Number(page&&page.height);
        if(!Number.isInteger(pageNumber)||pageNumber<1)throw new Error('Annotation page number is invalid.');
        if(seenPages.has(pageNumber))throw new Error(`Annotation page ${pageNumber} is duplicated.`);
        if(Number.isInteger(sourcePageCount)&&sourcePageCount>0&&pageNumber>sourcePageCount){
            throw new Error(`Annotation page ${pageNumber} is outside the source PDF.`);
        }
        seenPages.add(pageNumber);
        if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0){
            throw new Error(`Annotation page ${pageNumber} has invalid dimensions.`);
        }
        validatePortableFabricJson(page.fabric);
    });
    if(value.nativeAnnotations!==undefined){
        const native=value.nativeAnnotations;
        if(!native||native.version!==window.NativeAnnotationUtils.NATIVE_FORMAT_VERSION||!Array.isArray(native.descriptors)){
            throw new Error('Embedded native annotation metadata is invalid.');
        }
        if(native.descriptors.length>10000)throw new Error('Embedded native annotation metadata contains too many objects.');
        native.descriptors.forEach(descriptor=>{
            if(!descriptor||typeof descriptor.id!=='string'||!descriptor.id||descriptor.id.length>200){
                throw new Error('Embedded native annotation ID is invalid.');
            }
            if(!Number.isInteger(Number(descriptor.pageIndex))||Number(descriptor.pageIndex)<0){
                throw new Error('Embedded native annotation page is invalid.');
            }
            if(!Array.isArray(descriptor.rect)||descriptor.rect.length!==4||descriptor.rect.some(value=>!Number.isFinite(Number(value)))){
                throw new Error('Embedded native annotation rectangle is invalid.');
            }
        });
    }
    return value;
}

async function readEmbeddedAnnotationState(pdfProxy){
    if(!pdfProxy||typeof pdfProxy.getAttachments!=='function')return null;
    const attachments=await pdfProxy.getAttachments();
    // Ordinary PDFs have no editable package. Do not mistake an unavailable
    // helper script for damaged embedded data when there is nothing to restore.
    if(!attachments||!Object.keys(attachments).length)return null;
    if(!window.EmbeddedAnnotationUtils){
        throw new Error('Annotation library unavailable. Reload the page and try again.');
    }
    const state=window.EmbeddedAnnotationUtils.readStateFromAttachments(attachments);
    if(!state)return null;
    const payload=ensureAnnotationPackage(state.payload);
    window.EmbeddedAnnotationUtils.repairMissingObjectMetadata(payload);
    return {
        mode:state.mode||'legacy',
        sourcePdfBytes:state.sourcePdfBytes,
        payload
    };
}

async function createNativeEditingPdf(pdfBytes){
    const {PDFDocument}=window.PDFLib;
    let document;
    try{document=await PDFDocument.load(pdfBytes);}
    catch(error){document=await PDFDocument.load(pdfBytes,{ignoreEncryption:true});}
    const descriptors=window.NativeAnnotationUtils.readDraftNativeAnnotations(document,window.PDFLib);
    window.NativeAnnotationUtils.stripDraftNativeAnnotations(document,window.PDFLib);
    const displayBytes=await document.save({useObjectStreams:true});
    return {descriptors,displayBytes};
}

const PORTABLE_FABRIC_TYPES=new Set([
    'rect','ellipse','line','path','i-text','itext','text','textbox','group','triangle','image'
]);

function validatePortableFabricJson(fabricJson){
    if(!fabricJson||!Array.isArray(fabricJson.objects))throw new Error('Annotation page data is invalid.');
    let objectCount=0;
    const visit=(object,depth=0)=>{
        if(!object||typeof object!=='object'||depth>12)throw new Error('Annotation object structure is invalid.');
        objectCount+=1;
        if(objectCount>10000)throw new Error('Embedded annotation data contains too many objects.');
        const type=String(object.type||'').toLowerCase();
        if(!PORTABLE_FABRIC_TYPES.has(type))throw new Error(`Unsupported annotation object type: ${type||'unknown'}.`);
        if(type==='image'){
            const src=String(object.src||'');
            if(!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src)){
                throw new Error('Annotation images must be embedded PNG, JPEG, WebP, or GIF data.');
            }
        }
        if(type==='path'&&Array.isArray(object.path)&&object.path.length>100000){
            throw new Error('Annotation path is too complex.');
        }
        if(object.draftAnnotationId!==undefined&&
            (typeof object.draftAnnotationId!=='string'||!object.draftAnnotationId||object.draftAnnotationId.length>200)){
            throw new Error('Annotation object ID is invalid.');
        }
        const children=Array.isArray(object.objects)?object.objects:(Array.isArray(object._objects)?object._objects:[]);
        children.forEach(child=>visit(child,depth+1));
    };
    fabricJson.objects.forEach(object=>visit(object));
    return fabricJson;
}

async function ensureAnnotationPageRendered(pageNumber){
    if(fabricCanvases.has(pageNumber))return fabricCanvases.get(pageNumber);
    if(pageNumber<1||pageNumber>numPages)throw new Error(`Page ${pageNumber} is not in this PDF.`);
    const container=document.querySelector(`[data-page-num="${pageNumber}"]`);
    await renderPage(pageNumber,container);
    const canvas=fabricCanvases.get(pageNumber);
    if(!canvas)throw new Error(`Could not prepare page ${pageNumber}.`);
    return canvas;
}

async function enlivenFabricObjects(objects){
    const serialized=objects||[];
    let enlivened;
    if(FABRIC_MAJOR_VERSION>=6)enlivened=await fabric.util.enlivenObjects(serialized);
    else enlivened=await new Promise((resolve,reject)=>{
        try{fabric.util.enlivenObjects(serialized,resolve);}catch(error){reject(error);}
    });
    (enlivened||[]).forEach((object,index)=>{
        const source=serialized[index]||{};
        copySerializedAnnotationMetadata(source,object);
    });
    return enlivened||[];
}

async function restoreEmbeddedPageAnnotations(targetCanvas,pageData){
    validatePortableFabricJson(pageData&&pageData.fabric);
    const objects=await enlivenFabricObjects(pageData.fabric.objects);
    const target=annotationPageSize(targetCanvas);
    const nativeActual=pageData._nativeActualById||new Map();
    const nativeSaved=pageData._nativeSavedById||new Map();
    const jsPage=(nativeActual.size&&nativeSaved.size)?await pdfDoc.getPage(targetCanvas._pageNum):null;
    const {scale:scaleFactor,offsetX,offsetY}=window.EditorUtils.getContainTransform(
        Number(pageData.width),Number(pageData.height),target.width,target.height);
    targetCanvas._restoring=true;
    targetCanvas._suppressHistory=true;
    try{
        targetCanvas.getObjects().slice().forEach(object=>targetCanvas.remove(object));
        objects.forEach(object=>{
            object.set({
                left:offsetX+((Number(object.left)||0)*scaleFactor),
                top:offsetY+((Number(object.top)||0)*scaleFactor),
                scaleX:(Number(object.scaleX)||1)*scaleFactor,
                scaleY:(Number(object.scaleY)||1)*scaleFactor
            });
            const actual=nativeActual.get(object.draftAnnotationId);
            const saved=nativeSaved.get(object.draftAnnotationId);
            if(actual&&saved&&!nativeDescriptorsEqual(actual,saved)){
                reconcileFabricObjectWithNativeAnnotation(object,actual,saved,targetCanvas,jsPage);
            }
            if(isHighlightLayerObject(object))normalizeHighlightVisual(object);
            applyObjectInteractivity(object);
            if(isTextObject(object))configureTextObjectRendering(object);
            targetCanvas.add(object);
        });
    }finally{
        targetCanvas._suppressHistory=false;
        targetCanvas._restoring=false;
    }
    targetCanvas.requestRenderAll();
    const state=getSerializedCanvasState(targetCanvas);
    targetCanvas._lastSavedState=state;
    targetCanvas._historySeeded=false;
    savedStateByPage.set(targetCanvas._pageNum,state);
    return objects.length;
}

function roundedNativeValue(value){
    if(Array.isArray(value))return value.map(roundedNativeValue);
    if(typeof value==='number')return Math.round(value*1000)/1000;
    return value===undefined?null:value;
}

function nativeDescriptorsEqual(actual,saved){
    const keys=['kind','rect','color','fillColor','opacity','width','contents','line','inkLists','vertices'];
    return keys.every(key=>JSON.stringify(roundedNativeValue(actual[key]))===JSON.stringify(roundedNativeValue(saved[key])));
}

function mapPdfPointToDisplay(pdfPoint,rot,pxW,pxH,boxX,boxY,boxW,boxH){
    const u=boxW?(pdfPoint.x-boxX)/boxW:0;
    const v=boxH?(pdfPoint.y-boxY)/boxH:0;
    switch(rot){
        case 90:return {x:v*pxW,y:u*pxH};
        case 180:return {x:(1-u)*pxW,y:v*pxH};
        case 270:return {x:(1-v)*pxW,y:(1-u)*pxH};
        default:return {x:u*pxW,y:(1-v)*pxH};
    }
}

function nativeRectToDisplayBounds(rect,canvas,jsPage){
    if(!Array.isArray(rect)||rect.length!==4||!jsPage)return null;
    const view=jsPage.view||[0,0,1,1];
    const rot=normalizeRotationAngle(jsPage.rotate);
    const target=annotationPageSize(canvas);
    const points=[
        mapPdfPointToDisplay({x:rect[0],y:rect[1]},rot,target.width,target.height,view[0],view[1],view[2]-view[0],view[3]-view[1]),
        mapPdfPointToDisplay({x:rect[2],y:rect[3]},rot,target.width,target.height,view[0],view[1],view[2]-view[0],view[3]-view[1])
    ];
    return {
        left:Math.min(points[0].x,points[1].x),
        top:Math.min(points[0].y,points[1].y),
        width:Math.abs(points[1].x-points[0].x),
        height:Math.abs(points[1].y-points[0].y)
    };
}

function nativeRgbToHex(color){
    if(!Array.isArray(color)||color.length<3)return '#000000';
    return '#'+color.slice(0,3).map(value=>Math.round(Math.max(0,Math.min(1,Number(value)||0))*255).toString(16).padStart(2,'0')).join('');
}

function reconcileFabricObjectWithNativeAnnotation(object,actual,saved,canvas,jsPage){
    const oldBounds=nativeRectToDisplayBounds(saved.rect,canvas,jsPage);
    const newBounds=nativeRectToDisplayBounds(actual.rect,canvas,jsPage);
    if(oldBounds&&newBounds&&oldBounds.width>0&&oldBounds.height>0){
        const current=object.getBoundingRect(true,true);
        const scaleX=newBounds.width/oldBounds.width;
        const scaleY=newBounds.height/oldBounds.height;
        const targetLeft=newBounds.left+((current.left-oldBounds.left)*scaleX);
        const targetTop=newBounds.top+((current.top-oldBounds.top)*scaleY);
        object.set({
            scaleX:(Number(object.scaleX)||1)*scaleX,
            scaleY:(Number(object.scaleY)||1)*scaleY
        });
        object.setCoords();
        const scaled=object.getBoundingRect(true,true);
        object.set({
            left:(Number(object.left)||0)+(targetLeft-scaled.left),
            top:(Number(object.top)||0)+(targetTop-scaled.top)
        });
    }
    const color=nativeRgbToHex(actual.color);
    if(isTextObject(object)){
        object.set({text:String(actual.contents||''),fill:color});
        if(object.initDimensions)object.initDimensions();
    }else if(isArrowGroup(object)){
        const widthRatio=Number(saved.width)>0&&Number(actual.width)>0?Number(actual.width)/Number(saved.width):1;
        setArrowGroupAppearance(object,getStrokeWidthForObject(object)*widthRatio,color);
    }else if(!isHighlightLayerObject(object)){
        const widthRatio=Number(saved.width)>0&&Number(actual.width)>0?Number(actual.width)/Number(saved.width):1;
        object.set({stroke:color,strokeWidth:(Number(object.strokeWidth)||1)*widthRatio});
    }else{
        object._hlBaseColor=color;
    }
    if(Array.isArray(actual.fillColor)){
        if(isPageTextReplacement(object))object.set({backgroundColor:nativeRgbToHex(actual.fillColor)});
        else if(supportsFillObject(object))object.set({fill:nativeRgbToHex(actual.fillColor)});
    }
    object.setCoords();
}

async function hydrateEmbeddedAnnotations(payload,nativeDescriptors=[]){
    let restored=0;
    const hasNativeState=!!(payload.nativeAnnotations&&payload.nativeAnnotations.version===window.NativeAnnotationUtils.NATIVE_FORMAT_VERSION&&
        Array.isArray(payload.nativeAnnotations.descriptors));
    const actualById=new Map((nativeDescriptors||[]).map(descriptor=>[descriptor.id,descriptor]));
    const savedById=new Map(hasNativeState
        ?payload.nativeAnnotations.descriptors.map(descriptor=>[descriptor.id,descriptor])
        :[]);
    for(const pageData of payload.pages){
        const pageNumber=Number(pageData.pageNumber);
        if(pageNumber<1||pageNumber>numPages)continue;
        const objects=hasNativeState
            ?pageData.fabric.objects.filter(object=>object.draftAnnotationId&&actualById.has(object.draftAnnotationId))
            :pageData.fabric.objects;
        const restorablePage={
            ...pageData,
            fabric:{...pageData.fabric,objects},
            _nativeActualById:actualById,
            _nativeSavedById:savedById
        };
        restored+=objects.length;
        const canvas=fabricCanvases.get(pageNumber);
        if(canvas)await restoreEmbeddedPageAnnotations(canvas,restorablePage);
        else pendingEmbeddedPageAnnotations.set(pageNumber,restorablePage);
    }
    recomputeUnsavedChanges();
    return restored;
}

function undo(){
    if(historyRestoreInProgress){showMsg('Undo in progress');return;}
    if(historyPointer<=0){showMsg("Nothing to undo");return;}
    historyPointer--;
    const entry=historyStack[historyPointer];
    const canvas=fabricCanvases.get(entry.pageNum);
    if(!canvas){historyPointer++;showMsg("Nothing to undo");return;}
    if(canvas._restoring){historyPointer++;return;}
    historyRestoreInProgress=true;
    canvas._restoring=true;
    loadFabricCanvasFromJson(canvas,entry.state,()=>{
        canvas._restoring=false;
        historyRestoreInProgress=false;
        refreshCanvasTextRendering(canvas);
        canvas.forEachObject(o=>{
            if(isHighlightLayerObject(o))normalizeHighlightVisual(o);
            applyObjectInteractivity(o);
        });
        canvas.renderAll();
        canvas._lastSavedState=entry.state;
        recomputeUnsavedChanges();
        syncSizeControl();
    },copySerializedAnnotationMetadata).catch(error=>{
        canvas._restoring=false;historyRestoreInProgress=false;historyPointer++;
        console.error('Undo restore failed:',error);showMsg('Undo failed');
    });
    currentVisiblePage=entry.pageNum;
    activeContextPageNum=entry.pageNum;
    updatePageIndicator();
    scrollPageIntoViewIfNeeded(entry.pageNum);
    showMsg("Undo");
}

function redo(){
    if(historyRestoreInProgress){showMsg('Redo in progress');return;}
    if(historyPointer>=historyStack.length-1){showMsg("Nothing to redo");return;}
    historyPointer++;
    const entry=historyStack[historyPointer];
    const canvas=fabricCanvases.get(entry.pageNum);
    if(!canvas){historyPointer--;showMsg("Nothing to redo");return;}
    if(canvas._restoring){historyPointer--;return;}
    historyRestoreInProgress=true;
    canvas._restoring=true;
    loadFabricCanvasFromJson(canvas,entry.state,()=>{
        canvas._restoring=false;
        historyRestoreInProgress=false;
        refreshCanvasTextRendering(canvas);
        canvas.forEachObject(o=>{
            if(isHighlightLayerObject(o))normalizeHighlightVisual(o);
            applyObjectInteractivity(o);
        });
        canvas.renderAll();
        canvas._lastSavedState=entry.state;
        recomputeUnsavedChanges();
        syncSizeControl();
    },copySerializedAnnotationMetadata).catch(error=>{
        canvas._restoring=false;historyRestoreInProgress=false;historyPointer--;
        console.error('Redo restore failed:',error);showMsg('Redo failed');
    });
    currentVisiblePage=entry.pageNum;
    activeContextPageNum=entry.pageNum;
    updatePageIndicator();
    scrollPageIntoViewIfNeeded(entry.pageNum);
    showMsg("Redo");
}

function clampNumber(v,min,max){
    return Math.max(min,Math.min(max,v));
}

// block:'nearest' is a no-op when the page is already fully visible, so this
// only scrolls when an undo/redo lands on an off-screen page.
function scrollPageIntoViewIfNeeded(pageNum){
    const pageEl=document.querySelector(`[data-page-num="${pageNum}"]`);
    if(pageEl)pageEl.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function hexToRgbChannels(hex){
    const raw=(hex||'').trim();
    const full=/^#([0-9a-f]{6})$/i.exec(raw);
    if(full){
        return {
            r:parseInt(full[1].slice(0,2),16),
            g:parseInt(full[1].slice(2,4),16),
            b:parseInt(full[1].slice(4,6),16)
        };
    }
    const short=/^#([0-9a-f]{3})$/i.exec(raw);
    if(short){
        return {
            r:parseInt(short[1][0]+short[1][0],16),
            g:parseInt(short[1][1]+short[1][1],16),
            b:parseInt(short[1][2]+short[1][2],16)
        };
    }
    return null;
}

function rgbaFromHex(hex,alpha){
    const rgb=hexToRgbChannels(hex);
    if(!rgb)return 'transparent';
    const a=clampNumber(Number(alpha)||0,0,1);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a.toFixed(3)})`;
}

function isTextObject(obj){
    return !!obj&&(isFabricType(obj,'itext','text','fabrictext','textbox')||(fabric.IText&&obj instanceof fabric.IText));
}

function isPageTextReplacement(obj){
    return !!obj&&isTextObject(obj)&&obj.annotationType==='pageTextReplacement';
}

function isObjectEditableForTool(obj,tool=activeTool){
    return tool==='select'||(tool==='pageText'&&isPageTextReplacement(obj));
}

function applyObjectInteractivity(obj,tool=activeTool){
    if(!obj)return;
    const canEdit=isObjectEditableForTool(obj,tool);
    if(isHighlightLayerObject(obj))applyHighlightSelectability(obj,canEdit);
    else obj.set({selectable:canEdit,evented:canEdit,perPixelTargetFind:false});
    // Tool changes happen after Fabric's pointer event that finalized a drawn
    // shape. Refresh the cached hit polygon at the moment editing is enabled so
    // a new, restored, pasted, undone, or redone object is clickable on the very
    // first pointer-down instead of only after marquee selection.
    if(canEdit&&typeof obj.setCoords==='function')obj.setCoords();
}

function updateEditingTextLayout(obj){
    if(!isTextObject(obj)||!obj.isEditing)return;
    if(typeof obj._updateTextarea==='function'){
        try{obj._updateTextarea();}catch(e){}
    }
    if(typeof obj.updateTextareaPosition==='function'){
        try{obj.updateTextareaPosition();}catch(e){}
    }
    if(obj.hiddenTextarea){
        const selectionStart=Number.isFinite(obj.selectionStart)?obj.selectionStart:0;
        const selectionEnd=Number.isFinite(obj.selectionEnd)?obj.selectionEnd:selectionStart;
        try{
            obj.hiddenTextarea.selectionStart=selectionStart;
            obj.hiddenTextarea.selectionEnd=selectionEnd;
        }catch(e){}
    }
}

function configureTextObjectRendering(obj){
    if(!isTextObject(obj))return;
    obj.set({objectCaching:false,noScaleCache:false});
    obj.dirty=true;
    if(!obj.isEditing&&obj.initDimensions)obj.initDimensions();
    obj.setCoords();
    updateEditingTextLayout(obj);
}

function refreshCanvasTextRendering(canvas){
    if(!canvas)return;
    const selectMode=activeTool==='select';
    canvas.getObjects().forEach(obj=>{
        if(isHighlightLayerObject(obj)){
            normalizeHighlightVisual(obj);
            applyHighlightSelectability(obj,selectMode);
        }
        if(isTextObject(obj))configureTextObjectRendering(obj);
    });
}

function captureEditingTextStates(){
    const states=[];
    fabricCanvases.forEach(canvas=>{
        const activeObj=canvas.getActiveObject();
        if(!activeObj||!isTextObject(activeObj)||!activeObj.isEditing)return;
        states.push({
            canvas,
            object:activeObj,
            selectionStart:Number.isFinite(activeObj.selectionStart)?activeObj.selectionStart:0,
            selectionEnd:Number.isFinite(activeObj.selectionEnd)?activeObj.selectionEnd:(Number.isFinite(activeObj.selectionStart)?activeObj.selectionStart:0)
        });
    });
    if(!states.length)return states;
    suppressTextEditingLifecycle=true;
    try{
        states.forEach(state=>{
            if(state.object&&typeof state.object.exitEditing==='function')state.object.exitEditing();
            if(state.canvas&&state.object&&state.object.canvas===state.canvas)state.canvas.setActiveObject(state.object);
        });
    }finally{
        suppressTextEditingLifecycle=false;
    }
    return states;
}

function restoreEditingTextStates(states,{resumeEditing=false}={}){
    if(!Array.isArray(states)||!states.length)return;
    suppressTextEditingLifecycle=true;
    try{
        states.forEach(state=>{
            const {canvas,object,selectionStart,selectionEnd}=state;
            if(!canvas||!object||object.canvas!==canvas)return;
            canvas.setActiveObject(object);
            if(object.initDimensions)object.initDimensions();
            if(resumeEditing&&typeof object.enterEditing==='function'){
                object.enterEditing();
                object.selectionStart=selectionStart;
                object.selectionEnd=selectionEnd;
            }
            configureTextObjectRendering(object);
            if(resumeEditing)updateEditingTextLayout(object);
            canvas.requestRenderAll();
        });
    }finally{
        suppressTextEditingLifecycle=false;
    }
}

function configureFabricTextDefaults(){
    if(typeof fabric==='undefined')return;
    if(fabric.FabricObject&&fabric.FabricObject.ownDefaults){
        fabric.FabricObject.ownDefaults.originX='left';
        fabric.FabricObject.ownDefaults.originY='top';
    }
    const textClasses=[fabric.FabricText||fabric.Text,fabric.IText,fabric.Textbox];
    textClasses.forEach(Klass=>{
        if(!Klass||!Klass.prototype)return;
        Klass.prototype.objectCaching=false;
        Klass.prototype.noScaleCache=false;
    });
}

configureFabricTextDefaults();

function isArrowGroup(obj){
    return !!obj&&isFabricType(obj,'group')&&(obj.annotationType==='arrow'||obj.annotationType==='doubleArrow');
}

function supportsFillObject(obj){
    if(!obj)return false;
    if(isHighlightAreaObject(obj))return false;
    if(isFabricType(obj,'rect','ellipse'))return true;
    if(isFabricType(obj,'path')&&obj.annotationType==='cloud')return true;
    return false;
}

function getCurrentShapeFill(colorOverride=null){
    if(!shapeFillEnabled)return 'transparent';
    return rgbaFromHex(colorOverride||currentColor,shapeFillOpacity/100);
}

// Highlight layer — flat overlay like a real marker.
// Rendering strategy: each highlight object is kept at opacity:0 so Fabric's
// own render pass draws nothing visual. An after:render hook then redraws
// every highlight onto an offscreen canvas at OPAQUE color — so N
// overlapping shapes fuse into a single opaque silhouette — and blits that
// offscreen onto the main canvas once at HIGHLIGHT_LAYER_ALPHA. Net result:
// N overlapping highlights of the same color render as one flat region at
// 35% alpha, not stacked 35%+35%+35% (which darkens with overlap).
//
// The objects themselves are stored with real rgba colors on stroke/fill so
// the serialized JSON still describes a sensible shape if something bypasses
// the composite (e.g. third-party Fabric exporters). Selection borders and
// corner handles use their own colors and are drawn by Fabric's control
// pipeline, so they remain visible even though opacity is 0.
const HIGHLIGHT_LAYER_ALPHA=0.35;

function getHighlightBrushColor(colorOverride=null){
    return rgbaFromHex(colorOverride||currentColor,HIGHLIGHT_LAYER_ALPHA);
}

function getHighlightAreaFillColor(colorOverride=null){
    return rgbaFromHex(colorOverride||currentColor,HIGHLIGHT_LAYER_ALPHA);
}

function getHighlightAreaStrokeColor(){
    // Boxes and ellipses have no border — the flat rgba fill is the whole visual.
    return 'transparent';
}

function getNormalizedControlStrokeWidth(width=currentStrokeWidth){
    const numericWidth=Number(width);
    const fallbackWidth=Number(currentStrokeWidth);
    const resolvedWidth=Number.isFinite(numericWidth)
        ? numericWidth
        : (Number.isFinite(fallbackWidth)?fallbackWidth:1);
    return clampNumber(resolvedWidth,1,maxStrokeSize);
}

function getHighlightBrushWidth(controlWidth=currentStrokeWidth){
    return getNormalizedControlStrokeWidth(controlWidth)*3;
}

function isHighlightAreaObject(obj){
    return !!obj&&(obj.annotationType==='highlightBox'||obj.annotationType==='highlightEllipse');
}

function isHighlightPenObject(obj){
    return !!obj&&obj.annotationType==='highlightPen';
}

function isHighlightLayerObject(obj){
    return isHighlightPenObject(obj)||isHighlightAreaObject(obj);
}

// Store real rgba on stroke/fill (so serialization round-trips) and set
// opacity:0 so Fabric's main render pass skips the geometry — the after:render
// hook redraws the flat composite.
function normalizeHighlightVisual(obj){
    if(!isHighlightLayerObject(obj))return;
    if(obj._hlTempShape)return; // temp shape during drag: leave opacity:1 for live feedback
    const base=obj._hlBaseColor||(typeof obj.stroke==='string'&&obj.stroke)||currentColor;
    obj._hlBaseColor=base;
    // objectCaching:false is required because the flat-layer composite mutates
    // fill/stroke/opacity on each frame to re-render at opaque color. With
    // caching on, Rect/Ellipse would return the cached image from their last
    // render (at rgba 35%) and overlapping boxes would still stack additively.
    obj.set({opacity:0, strokeUniform:true, objectCaching:false});
    obj.dirty=true;
    if(isHighlightPenObject(obj)){
        obj.set({stroke:getHighlightBrushColor(base), fill:''});
    }else{
        obj.set({
            fill:getHighlightAreaFillColor(base),
            stroke:'transparent', strokeWidth:0
        });
    }
}

// Draw every highlight on `fc` onto an offscreen canvas at opaque color,
// then blit that onto `destCtx` at HIGHLIGHT_LAYER_ALPHA. Because the
// offscreen uses opaque paint, overlapping highlights of the same color
// merge into one flat silhouette before the alpha is applied. Used for both
// live canvas rendering (after:render) and PDF export.
function compositeHighlightLayer(fc,destCtx,{destWidth,destHeight,transform=null}={}){
    if(!fc||!destCtx)return;
    // Skip the temp shape: it renders itself live (rgba + opacity:1) during drag.
    const hls=fc.getObjects().filter(o=>o.visible!==false&&isHighlightLayerObject(o)&&!o._hlTempShape);
    if(!hls.length)return;
    const w=destWidth||destCtx.canvas.width;
    const h=destHeight||destCtx.canvas.height;
    const off=document.createElement('canvas');
    off.width=w; off.height=h;
    const oCtx=off.getContext('2d');
    if(!oCtx)return;
    if(transform){
        oCtx.setTransform(transform[0],transform[1],transform[2],transform[3],transform[4],transform[5]);
    }
    hls.forEach(obj=>{
        const savedOpacity=obj.opacity;
        const savedStroke=obj.stroke;
        const savedFill=obj.fill;
        const savedStrokeWidth=obj.strokeWidth;
        const savedCaching=obj.objectCaching;
        const base=obj._hlBaseColor||savedStroke||savedFill||currentColor;
        obj.opacity=1;
        // Disable caching and force a dirty flag so Fabric ignores any stored
        // render (which would have the rgba fill) and rebuilds with the opaque
        // color we're swapping in for this pass.
        obj.objectCaching=false;
        obj.dirty=true;
        if(isHighlightPenObject(obj)){
            obj.stroke=base; obj.fill='';
        }else{
            obj.fill=base; obj.stroke='transparent'; obj.strokeWidth=0;
        }
        oCtx.save();
        obj.render(oCtx);
        oCtx.restore();
        obj.opacity=savedOpacity;
        obj.stroke=savedStroke;
        obj.fill=savedFill;
        obj.strokeWidth=savedStrokeWidth;
        obj.objectCaching=savedCaching;
        obj.dirty=true;
    });
    destCtx.save();
    destCtx.setTransform(1,0,0,1,0,0);
    destCtx.globalAlpha=HIGHLIGHT_LAYER_ALPHA;
    destCtx.globalCompositeOperation='source-over';
    destCtx.drawImage(off,0,0);
    destCtx.restore();
}

// Fabric's live canvas context is pre-scaled for the backing-store/device-pixel
// ratio before it applies the viewport transform. The highlight compositor uses
// its own raw offscreen canvas, so it must apply both transforms explicitly.
// Using the actual backing-store dimensions is more reliable than reading the
// current devicePixelRatio after the browser zoom level has changed.
function getLiveCanvasRenderTransform(canvas){
    const vpt=canvas&&canvas.viewportTransform||[1,0,0,1,0,0];
    const logicalWidth=Math.max(1,Number(canvas&&canvas.getWidth&&canvas.getWidth())||Number(canvas&&canvas.width)||1);
    const logicalHeight=Math.max(1,Number(canvas&&canvas.getHeight&&canvas.getHeight())||Number(canvas&&canvas.height)||1);
    const backingWidth=Number(canvas&&canvas.lowerCanvasEl&&canvas.lowerCanvasEl.width)||logicalWidth;
    const backingHeight=Number(canvas&&canvas.lowerCanvasEl&&canvas.lowerCanvasEl.height)||logicalHeight;
    const scaleX=backingWidth/logicalWidth;
    const scaleY=backingHeight/logicalHeight;
    return [
        vpt[0]*scaleX,
        vpt[1]*scaleY,
        vpt[2]*scaleX,
        vpt[3]*scaleY,
        vpt[4]*scaleX,
        vpt[5]*scaleY
    ];
}

// Toggle selectability to match the active tool. Highlights are only
// movable/resizable when the Select tool is active. perPixelTargetFind is
// forced off per-object because highlights render at opacity:0 (the flat
// composite handles their actual visuals), and pixel-based hit testing
// would read zero alpha there and fail to detect clicks.
function applyHighlightSelectability(obj,selectMode){
    if(!isHighlightLayerObject(obj))return;
    obj.set({
        selectable:selectMode, evented:selectMode,
        hasControls:selectMode, hasBorders:selectMode,
        perPixelTargetFind:false,
        borderColor:'rgba(102,153,255,0.75)',
        cornerColor:'rgba(102,153,255,0.75)',
        cornerStyle:'circle', transparentCorners:false
    });
}

function refreshHighlightLayer(canvas){
    if(!canvas)return;
    const selectMode=activeTool==='select';
    canvas.getObjects().forEach(o=>{
        if(!isHighlightLayerObject(o))return;
        normalizeHighlightVisual(o);
        applyHighlightSelectability(o,selectMode);
    });
}

function clearActiveSelectionsExcept(pageNum){
    for(const [pn,canvas] of fabricCanvases){
        if(pn===pageNum)continue;
        if(canvas.getActiveObject()){
            canvas.discardActiveObject();
            canvas.requestRenderAll();
        }
    }
}

function getActiveSelectionContext(){
    const contextPageCandidates=[activeContextPageNum,currentVisiblePage];
    for(const pageNum of contextPageCandidates){
        if(!Number.isFinite(pageNum))continue;
        const canvas=fabricCanvases.get(pageNum);
        if(!canvas)continue;
        const activeObj=canvas.getActiveObject();
        if(!activeObj)continue;
        const objects=isFabricType(activeObj,'activeSelection')?activeObj.getObjects():[activeObj];
        return {canvas,activeObj,objects,pageNum};
    }
    return null;
}

function clonePlainData(value){
    return JSON.parse(JSON.stringify(value));
}

function getClipboardTargetCanvas(){
    // Always paste on the currently visible page (shown in the page indicator)
    const vc=fabricCanvases.get(currentVisiblePage);
    if(vc)return vc;
    return null;
}

function activateCanvasObjects(canvas,objects){
    if(!canvas)return;
    canvas.discardActiveObject();
    if(objects.length===1){
        canvas.setActiveObject(objects[0]);
    }else if(objects.length>1){
        const selection=new fabric.ActiveSelection(objects,{canvas});
        selection.setCoords();
        canvas.setActiveObject(selection);
    }
    canvas.requestRenderAll();
    activeContextPageNum=canvas._pageNum||activeContextPageNum;
    syncSizeControl();
}

function serializeObjectsForClipboard(objects){
    return objects.map(obj=>obj.toObject(CLIPBOARD_OBJECT_PROPS));
}

function serializeSelectionContextForClipboard(selectionContext){
    if(!selectionContext||!selectionContext.objects.length)return [];
    const {canvas,activeObj,objects}=selectionContext;
    if(!isFabricType(activeObj,'activeSelection'))return serializeObjectsForClipboard(objects);

    // Fabric stores members of an ActiveSelection in group-relative coordinates.
    // Dismantle the selection before serialization so pasted objects retain their
    // real page coordinates, then restore the selection without recording history.
    canvas.discardActiveObject();
    try{
        objects.forEach(object=>object.setCoords());
        return serializeObjectsForClipboard(objects);
    }finally{
        activateCanvasObjects(canvas,objects);
    }
}

function copySelectionToClipboard({silent=false,context=null}={}){
    const selectionContext=context||getActiveSelectionContext();
    if(!selectionContext||!selectionContext.objects.length)return false;
    const sourceSize=annotationPageSize(selectionContext.canvas);
    objectClipboard={
        objects:serializeSelectionContextForClipboard(selectionContext),
        source:{pageNumber:selectionContext.pageNum,width:sourceSize.width,height:sourceSize.height}
    };
    clipboardPasteCount=0;
    if(!silent){
        showMsg(selectionContext.objects.length>1?`Copied ${selectionContext.objects.length} objects`:'Copied');
    }
    return true;
}

function enlivenClipboardObjects(serializedObjects){
    return enlivenFabricObjects(serializedObjects);
}

function prepareClipboardObject(obj){
    if(!obj)return;
    // A pasted object is a new PDF annotation. Fabric 7 class-level custom
    // properties can include IDs even when a smaller toObject allow-list is
    // requested, so explicitly break both identities before adding the copy.
    delete obj.draftAnnotationId;
    ensureDraftAnnotationId(obj);
    if(isPageTextReplacement(obj))delete obj.pageTextSourceId;
    obj.set({selectable:true,evented:true});
    if(isHighlightLayerObject(obj)){
        normalizeHighlightVisual(obj);
        applyHighlightSelectability(obj,true);
    }
    if(isTextObject(obj))configureTextObjectRendering(obj);
    if(isArrowGroup(obj)){
        obj.set({lockScalingX:true,lockScalingY:true});
        const line=(obj._objects||[]).find(part=>isFabricType(part,'line'));
        const strokeColor=(line&&line.stroke)||currentColor;
        setArrowGroupAppearance(obj,getStrokeWidthForObject(obj),strokeColor);
    }
    obj.setCoords();
}

function keepObjectsInsideCanvas(canvas,objects,padding=8){
    if(!canvas||!objects.length)return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    objects.forEach(object=>{
        object.setCoords();
        const bounds=object.getBoundingRect(true,true);
        minX=Math.min(minX,bounds.left);
        minY=Math.min(minY,bounds.top);
        maxX=Math.max(maxX,bounds.left+bounds.width);
        maxY=Math.max(maxY,bounds.top+bounds.height);
    });
    if(!Number.isFinite(minX))return;
    const size=annotationPageSize(canvas);
    const translation=window.EditorUtils.getBoundsTranslationInsideContainer(
        {x:minX,y:minY,width:maxX-minX,height:maxY-minY},size.width,size.height,padding);
    if(!translation.dx&&!translation.dy)return;
    objects.forEach(object=>{
        object.set({
            left:(Number(object.left)||0)+translation.dx,
            top:(Number(object.top)||0)+translation.dy
        });
        object.setCoords();
    });
}

function removeSelectionFromCanvas(context){
    if(!context||!context.canvas||!context.activeObj)return false;
    const {canvas,activeObj}=context;
    canvas._suppressHistory=true;
    if(isFabricType(activeObj,'activeSelection')){
        activeObj.getObjects().forEach(obj=>canvas.remove(obj));
        canvas.discardActiveObject();
    }else{
        canvas.remove(activeObj);
    }
    canvas._suppressHistory=false;
    canvas.requestRenderAll();
    saveCanvasState(canvas);
    syncSizeControl();
    return true;
}

function cutSelectionToClipboard(){
    const context=getActiveSelectionContext();
    if(!context||!context.objects.length)return false;
    if(!copySelectionToClipboard({silent:true,context}))return false;
    if(!removeSelectionFromCanvas(context))return false;
    showMsg(context.objects.length>1?`Cut ${context.objects.length} objects`:'Cut');
    return true;
}

async function pasteClipboardObjects(payload=objectClipboard,{targetCanvas=null,offsetMultiplier=null,announce=true}={}){
    if(!payload||!Array.isArray(payload.objects)||!payload.objects.length){
        if(announce)showMsg('Clipboard empty');
        return false;
    }
    const canvas=targetCanvas||getClipboardTargetCanvas();
    if(!canvas){
        if(announce)showMsg('Scroll to a rendered page before pasting');
        return false;
    }
    if(activeTool!=='select')setActiveTool('select');
    clearActiveSelectionsExcept(canvas._pageNum);
    const objects=await enlivenClipboardObjects(clonePlainData(payload.objects));
    if(!objects.length){
        if(announce)showMsg('Clipboard empty');
        return false;
    }
    const nextOffset=Number.isFinite(offsetMultiplier)?offsetMultiplier:(clipboardPasteCount+1);
    const delta=KEYBOARD_PASTE_OFFSET*nextOffset;
    const targetSize=annotationPageSize(canvas);
    const sourceWidth=Number(payload.source&&payload.source.width)||targetSize.width;
    const sourceHeight=Number(payload.source&&payload.source.height)||targetSize.height;

    // Paste at the equivalent page position plus a small visible offset. Uniform
    // page scaling prevents distortion when copying between different page sizes.
    canvas._suppressHistory=true;
    canvas.discardActiveObject();
    objects.forEach(obj=>{
        obj.set(window.EditorUtils.getClipboardObjectPlacement(
            obj,sourceWidth,sourceHeight,targetSize.width,targetSize.height,delta));
        prepareClipboardObject(obj);
        canvas.add(obj);
    });
    keepObjectsInsideCanvas(canvas,objects);
    canvas._suppressHistory=false;
    activateCanvasObjects(canvas,objects);
    saveCanvasState(canvas);
    currentVisiblePage=canvas._pageNum||currentVisiblePage;
    updatePageIndicator();
    if(payload===objectClipboard)clipboardPasteCount=nextOffset;
    if(announce){
        showMsg(objects.length>1?`Pasted ${objects.length} objects`:'Pasted');
    }
    return true;
}


function duplicateActiveSelection(){
    const context=getActiveSelectionContext();
    if(!context||!context.objects.length)return false;
    const sourceSize=annotationPageSize(context.canvas);
    const payload={
        objects:serializeSelectionContextForClipboard(context),
        source:{pageNumber:context.pageNum,width:sourceSize.width,height:sourceSize.height}
    };
    void pasteClipboardObjects(payload,{targetCanvas:context.canvas}).catch(error=>{
        console.error('Duplicate failed:',error);
        showMsg('Duplicate failed');
    });
    return true;
}

function selectAllOnActivePage(){
    const canvas=getClipboardTargetCanvas();
    if(!canvas)return false;
    const objects=canvas.getObjects().slice();
    if(!objects.length){
        showMsg('Nothing to select');
        return true;
    }
    if(activeTool!=='select')setActiveTool('select');
    clearActiveSelectionsExcept(canvas._pageNum);
    activateCanvasObjects(canvas,objects);
    showMsg(objects.length>1?`Selected ${objects.length} objects`:'Selected');
    return true;
}

function nudgeActiveSelection(dx,dy){
    const context=getActiveSelectionContext();
    if(!context||!context.objects.length)return false;
    context.objects.forEach(obj=>{
        obj.set({
            left:(Number(obj.left)||0)+dx,
            top:(Number(obj.top)||0)+dy
        });
        obj.setCoords();
    });
    activateCanvasObjects(context.canvas,context.objects);
    saveCanvasState(context.canvas);
    return true;
}

function getStrokeWidthForObject(obj){
    if(!obj)return currentStrokeWidth;
    if(isArrowGroup(obj)){
        const line=(obj._objects||[]).find(p=>isFabricType(p,'line'));
        return line&&Number.isFinite(line.strokeWidth)?line.strokeWidth:currentStrokeWidth;
    }
    return Number.isFinite(obj.strokeWidth)?obj.strokeWidth:currentStrokeWidth;
}

function getControlStrokeWidthForObject(obj){
    if(isHighlightPenObject(obj)){
        return clampNumber(Math.round(getStrokeWidthForObject(obj)/3),1,maxStrokeSize);
    }
    return clampNumber(Math.round(getStrokeWidthForObject(obj)),1,maxStrokeSize);
}

function computeArrowHeadSize(length,strokeWidth){
    const sw=Math.max(1,Number(strokeWidth)||1);
    const preferred=(sw*3.2)+4;
    const maxByLength=Math.max(8,(Number(length)||0)*0.35);
    return clampNumber(preferred,6,maxByLength);
}

function setArrowGroupAppearance(group,strokeWidth,color){
    if(!isArrowGroup(group))return;
    const parts=group._objects||[];
    const line=parts.find(p=>isFabricType(p,'line'));
    if(!line)return;
    const tips=parts.filter(p=>isFabricType(p,'triangle'));
    const sw=getNormalizedControlStrokeWidth(strokeWidth);
    const x1=Number(line.x1)||0;
    const y1=Number(line.y1)||0;
    const x2=Number(line.x2)||0;
    const y2=Number(line.y2)||0;
    const len=Math.hypot(x2-x1,y2-y1);
    const headSize=computeArrowHeadSize(len,sw);

    line.set({strokeWidth:sw,stroke:color,fill:color});
    tips.forEach(t=>t.set({
        width:headSize,
        height:headSize,
        fill:color,
        stroke:color,
        strokeWidth:Math.max(1,sw*0.35)
    }));

    group.dirty=true;
    if(group._calcBounds)group._calcBounds(true); // true = only update width/height, NOT position
    group.setCoords();
}

function setObjectStrokeWidth(obj,width){
    if(!obj)return;
    if(isArrowGroup(obj)){
        const line=(obj._objects||[]).find(p=>isFabricType(p,'line'));
        const strokeColor=(line&&line.stroke)||currentColor;
        setArrowGroupAppearance(obj,width,strokeColor);
        return;
    }
    if(isHighlightPenObject(obj)){
        obj.set('strokeWidth',getHighlightBrushWidth(width));
        return;
    }
    if(Object.prototype.hasOwnProperty.call(obj,'strokeWidth'))obj.set('strokeWidth',getNormalizedControlStrokeWidth(width));
}

function applyTextStyleUpdate(obj,styleUpdate){
    if(!isTextObject(obj)||!styleUpdate)return;
    const selectionStart=Number.isFinite(obj.selectionStart)?obj.selectionStart:0;
    const selectionEnd=Number.isFinite(obj.selectionEnd)?obj.selectionEnd:selectionStart;
    const textLength=((obj.text||'')+'').length;
    const hasPartialSelection=!!(
        obj.isEditing&&
        typeof obj.setSelectionStyles==='function'&&
        selectionEnd>selectionStart&&
        !(selectionStart===0&&selectionEnd===textLength)
    );
    if(hasPartialSelection)obj.setSelectionStyles(styleUpdate,selectionStart,selectionEnd);
    else obj.set(styleUpdate);
    if((Object.prototype.hasOwnProperty.call(styleUpdate,'fontSize')||Object.prototype.hasOwnProperty.call(styleUpdate,'fontFamily'))&&obj.initDimensions){
        obj.initDimensions();
    }
    configureTextObjectRendering(obj);
}

function setObjectColor(obj,color){
    if(!obj)return;
    if(isTextObject(obj)){
        applyTextStyleUpdate(obj,{fill:color});
        return;
    }
    if(isHighlightPenObject(obj)){
        obj._hlBaseColor=color;
        obj.set({stroke:getHighlightBrushColor(color)});
        return;
    }
    if(isHighlightAreaObject(obj)){
        obj._hlBaseColor=color;
        obj.set({stroke:getHighlightAreaStrokeColor(color),fill:getHighlightAreaFillColor(color)});
        return;
    }
    if(isArrowGroup(obj)){
        setArrowGroupAppearance(obj,getStrokeWidthForObject(obj),color);
        return;
    }
    if(Object.prototype.hasOwnProperty.call(obj,'stroke'))obj.set('stroke',color);
    if(supportsFillObject(obj)&&shapeFillEnabled)obj.set('fill',getCurrentShapeFill(color));
}

function setObjectFillFromCurrentStyle(obj){
    if(!supportsFillObject(obj))return;
    obj.set('fill',getCurrentShapeFill());
}

function getFillStateFromObject(obj){
    if(!supportsFillObject(obj))return null;
    const fill=(obj.fill||'').toString().trim().toLowerCase();
    if(!fill||fill==='transparent')return {enabled:false,opacity:0};
    const rgba=/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9]*\.?[0-9]+)\s*\)/i.exec(fill);
    if(rgba){
        const alpha=clampNumber(parseFloat(rgba[1]),0,1);
        return {enabled:true,opacity:Math.round(alpha*100)};
    }
    return {enabled:true,opacity:100};
}

function getSizeControlMode(context){
    if(context&&context.objects.length>0){
        const allText=context.objects.every(isTextObject);
        return allText?'text':'stroke';
    }
    return activeTool==='text'?'text':'stroke';
}

function applyTextStyleToObject(obj,fontSize,fontFamily){
    if(!isTextObject(obj))return;
    applyTextStyleUpdate(obj,{fontSize,fontFamily});
}

// ─── REVISION CLOUD GENERATOR ───────────────────────
function createRevisionCloud(x,y,w,h){
    const bump=12;
    let d='';
    function addBumps(x1,y1,x2,y2,nx,ny){
        const dx=x2-x1,dy=y2-y1;
        const len=Math.sqrt(dx*dx+dy*dy);
        const n=Math.max(2,Math.round(len/(bump*2)));
        const sx=dx/n,sy=dy/n;
        for(let i=0;i<n;i++){
            const px=x1+sx*i,py=y1+sy*i;
            const ex=x1+sx*(i+1),ey=y1+sy*(i+1);
            const cx=(px+ex)/2+nx*bump,cy=(py+ey)/2+ny*bump;
            if(i===0&&d==='') d=`M ${px} ${py} `;
            d+=`Q ${cx} ${cy} ${ex} ${ey} `;
        }
    }
    addBumps(x,y,x+w,y,0,-1);
    addBumps(x+w,y,x+w,y+h,1,0);
    addBumps(x+w,y+h,x,y+h,0,1);
    addBumps(x,y+h,x,y,-1,0);
    d+='Z';
    return new fabric.Path(d,{
        stroke:currentColor,strokeWidth:currentStrokeWidth,
        fill:getCurrentShapeFill(currentColor),selectable:true,evented:true,
        strokeUniform:true,
        hasControls:true,hasBorders:true,annotationType:'cloud'
    });
}

// ─── TOOL MANAGEMENT ────────────────────────────────
function isShapeModeTool(tool=activeTool){
    if(SHAPE_TOOLS.includes(tool))return true;
    if(tool!=='highlight')return false;
    return highlightMode==='box'||highlightMode==='ellipse';
}

function isFreeDrawModeTool(tool=activeTool){
    if(tool==='draw')return true;
    if(tool!=='highlight')return false;
    return highlightMode==='pen';
}

function configureHighlightBrush(canvas){
    if(!canvas)return;
    canvas.freeDrawingBrush=new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color=getHighlightBrushColor();
    canvas.freeDrawingBrush.width=getHighlightBrushWidth();
}

function getCursorForTool(t){
    return (isFreeDrawModeTool(t)||isShapeModeTool(t))?'crosshair':(t==='text'||t==='pageText')?'text':'default';
}

function stopPanning(){
    if(!isPanning)return;
    isPanning=false;
    fabricCanvases.forEach(c=>{c.defaultCursor=getCursorForTool(activeTool);});
}

function setActiveTool(t,{announce=true,persist=true}={}){
    // Exit any active text editing first - prevents stuck isEditingCanvas
    fabricCanvases.forEach(c=>{
        const ao=c.getActiveObject();
        if(ao&&isTextObject(ao)&&ao.isEditing){
            ao.exitEditing();
            c.discardActiveObject();
            c.renderAll();
        }
    });

    activeTool=t;
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active-tool',b.dataset.tool===t));

    const isFreeDraw=isFreeDrawModeTool(t);
    const cursor=getCursorForTool(t);
    const isSelect=t==='select';
    fabricCanvases.forEach(c=>{
        c.selection=isSelect;
        c.isDrawingMode=isFreeDraw;
        if(t==='draw'){
            c.freeDrawingBrush=new fabric.PencilBrush(c);
            c.freeDrawingBrush.color=currentColor;
            c.freeDrawingBrush.width=currentStrokeWidth;
        }else if(t==='highlight'&&highlightMode==='pen'){
            configureHighlightBrush(c);
        }
        c.defaultCursor=cursor;
        c.forEachObject(o=>{
            if(isHighlightLayerObject(o))normalizeHighlightVisual(o);
            applyObjectInteractivity(o,t);
        });
        if(!isSelect)c.discardActiveObject();
        c.requestRenderAll();
    });

    if(arrowModeGroup)arrowModeGroup.classList.toggle('hidden',t!=='arrow');
    if(highlightModeGroup)highlightModeGroup.classList.toggle('hidden',t!=='highlight');
    if(highlightModeDivider)highlightModeDivider.style.display=t==='highlight'?'block':'none';
    syncSizeControl();
    if(persist)persistToolbarPreference();
    if(announce)showMsg(TOOL_NAMES[t]||t);
}

function setColor(color,{persist=true,applySelection=true}={}){
    const normalizedColor=normalizeToolbarColor(color);
    if(!normalizedColor)return;
    currentColor=normalizedColor;
    document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('active-color',s.dataset.color===normalizedColor));

    const pw=document.getElementById('popoverWheel');
    const hi=document.getElementById('hexInput');
    const pd=document.getElementById('colorPreviewDot');
    const rb=document.getElementById('rainbowBtn');
    if(pw)pw.value=normalizedColor;
    if(hi&&document.activeElement!==hi)hi.value=normalizedColor.toUpperCase();
    if(pd)pd.style.background=normalizedColor;
    updatePopoverPreview(normalizedColor);
    const isPreset=[...document.querySelectorAll('.color-swatch')].some(s=>s.dataset.color===normalizedColor);
    if(rb)rb.classList.toggle('active-color',!isPreset);
    // Update draw brush if active
    if(activeTool==='draw'){
        fabricCanvases.forEach(c=>{
            if(c.freeDrawingBrush) c.freeDrawingBrush.color=normalizedColor;
        });
    }else if(activeTool==='highlight'&&highlightMode==='pen'){
        fabricCanvases.forEach(c=>{
            if(c.freeDrawingBrush) c.freeDrawingBrush.color=getHighlightBrushColor(normalizedColor);
        });
    }

    if(applySelection){
        const context=getActiveSelectionContext();
        if(context&&context.objects.length>0){
            context.objects.forEach(obj=>setObjectColor(obj,normalizedColor));
            context.canvas.requestRenderAll();
            saveCanvasState(context.canvas);
        }
    }
    syncSizeControl();
    if(persist)persistToolbarPreference();
}

// ─── UNIFIED SIZE CONTROL ───────────────────────────
function syncSizeControl(){
    const context=getActiveSelectionContext();
    const mode=getSizeControlMode(context);
    const showTextControls=mode==='text'||activeTool==='text';
    if(fontControlsGroup)fontControlsGroup.style.display=showTextControls?'flex':'none';
    fontFamilySelect.disabled=mode!=='text';

    sizeSlider.disabled=false;
    sizeNumber.disabled=false;

    if(mode==='text'){
        let textSize=currentFontSize;
        if(context&&context.objects.length>0&&context.objects.every(isTextObject)){
            const refText=context.objects.find(isTextObject);
            textSize=clampNumber(parseInt(refText.fontSize,10)||currentFontSize,8,maxTextSize);
        }
        sizeSlider.min=8;sizeSlider.max=maxTextSize;sizeSlider.step=1;
        sizeSlider.value=textSize;
        if(document.activeElement!==sizeNumber)sizeNumber.value=textSize;
        sizeNumber.min=8;sizeNumber.max=maxTextSize;
        sizeLabel.textContent='Sz';
    }else{
        let strokeSize=currentStrokeWidth;
        if(context&&context.objects.length>0){
            const ref=context.objects.find(o=>!isTextObject(o));
            if(ref){
                strokeSize=getControlStrokeWidthForObject(ref);
            }
        }
        sizeSlider.min=1;sizeSlider.max=maxStrokeSize;sizeSlider.step=1;
        sizeSlider.value=strokeSize;
        if(document.activeElement!==sizeNumber)sizeNumber.value=strokeSize;
        sizeNumber.min=1;sizeNumber.max=maxStrokeSize;
        sizeLabel.textContent='Wt';
    }

    const hasFillSelection=!!(context&&context.objects.some(supportsFillObject));
    const showFillControls=activeTool==='rect'||activeTool==='circle'||activeTool==='cloud'||hasFillSelection;
    if(fillControlsGroup)fillControlsGroup.classList.toggle('hidden',!showFillControls);
    if(fillDivider)fillDivider.style.display=showFillControls?'block':'none';
    if(showFillControls){
        if(hasFillSelection){
            const refFillObj=context.objects.find(supportsFillObject);
            const fillState=getFillStateFromObject(refFillObj);
            if(fillState){
                shapeFillEnabled=fillState.enabled;
                shapeFillOpacity=clampNumber(fillState.opacity,0,100);
            }
        }
        if(fillToggle)fillToggle.checked=shapeFillEnabled;
        if(fillOpacitySlider){
            fillOpacitySlider.value=shapeFillOpacity;
            fillOpacitySlider.disabled=!shapeFillEnabled;
        }
        if(fillOpacityNumber){
            fillOpacityNumber.value=shapeFillOpacity;
            fillOpacityNumber.disabled=!shapeFillEnabled;
        }
    }
}

function commitSizeNumberInput(){
    const raw=String(sizeNumber&&sizeNumber.value||'').trim();
    const numeric=Number(raw);
    if(!raw||!Number.isFinite(numeric)){
        syncSizeControl();
        return;
    }
    handleSizeChange(numeric);
}

function handleSizeChange(val){
    const context=getActiveSelectionContext();
    const mode=getSizeControlMode(context);
    if(mode==='text'){
        currentFontSize=clampNumber(parseInt(val,10)||12,8,maxTextSize);
        sizeSlider.value=currentFontSize;sizeNumber.value=currentFontSize;
        if(context&&context.objects.length>0){
            const textObjects=context.objects.filter(isTextObject);
            if(textObjects.length>0){
                textObjects.forEach(obj=>applyTextStyleToObject(obj,currentFontSize,currentFontFamily));
                context.canvas.requestRenderAll();
                saveCanvasState(context.canvas);
            }
        }else{
            updateSelectedObjectProperties();
        }
    }else{
        currentStrokeWidth=clampNumber(parseInt(val,10)||3,1,maxStrokeSize);
        sizeSlider.value=currentStrokeWidth;sizeNumber.value=currentStrokeWidth;
        if(context&&context.objects.length>0){
            const strokeObjects=context.objects.filter(o=>!isTextObject(o));
            if(strokeObjects.length>0){
                strokeObjects.forEach(obj=>setObjectStrokeWidth(obj,currentStrokeWidth));
                context.canvas.requestRenderAll();
                saveCanvasState(context.canvas);
            }
        }
        if(activeTool==='draw'){
            fabricCanvases.forEach(c=>{if(c.freeDrawingBrush)c.freeDrawingBrush.width=currentStrokeWidth;});
        }else if(activeTool==='highlight'&&highlightMode==='pen'){
            fabricCanvases.forEach(c=>{if(c.freeDrawingBrush)c.freeDrawingBrush.width=getHighlightBrushWidth();});
        }
    }
    syncSizeControl();
    persistToolbarPreference();
}

// ─── SHAPE DRAWING SYSTEM ───────────────────────────
function applyCurrentFillStyleToSelection(){
    const context=getActiveSelectionContext();
    if(context&&context.objects.length>0){
        const fillObjects=context.objects.filter(supportsFillObject);
        if(fillObjects.length>0){
            fillObjects.forEach(obj=>setObjectFillFromCurrentStyle(obj));
            context.canvas.requestRenderAll();
            saveCanvasState(context.canvas);
        }
    }
    syncSizeControl();
}

function handleFillToggleChange(checked){
    shapeFillEnabled=!!checked;
    applyCurrentFillStyleToSelection();
    persistToolbarPreference();
}

function handleFillOpacityChange(val){
    shapeFillOpacity=clampNumber(parseInt(val,10)||0,0,100);
    if(fillOpacitySlider)fillOpacitySlider.value=shapeFillOpacity;
    if(fillOpacityNumber)fillOpacityNumber.value=shapeFillOpacity;
    if(shapeFillEnabled)applyCurrentFillStyleToSelection();
    else syncSizeControl();
    persistToolbarPreference();
}

let shapeStart=null,tempShape=null,isShapeDrawing=false,shapeCanvas=null,currentShapeKind=null;

function createArrowGroup(x1,y1,x2,y2,mode='single'){
    const angle=Math.atan2(y2-y1,x2-x1);
    const baseAngle=(angle*180/Math.PI)+90;
    const lineLength=Math.hypot(x2-x1,y2-y1);
    const headSize=computeArrowHeadSize(lineLength,currentStrokeWidth);
    const baseLine=new fabric.Line([x1,y1,x2,y2],{
        strokeWidth:currentStrokeWidth,
        stroke:currentColor,
        fill:currentColor,
        strokeLineCap:'round',
        strokeUniform:true,
        selectable:false,
        evented:false
    });
    const arrowParts=[baseLine];
    const tipOptions={
        originX:'center',
        originY:'center',
        width:headSize,
        height:headSize,
        fill:currentColor,
        stroke:currentColor,
        strokeWidth:Math.max(1,currentStrokeWidth*0.35),
        strokeUniform:true,
        selectable:false,
        evented:false
    };
    arrowParts.push(new fabric.Triangle({
        ...tipOptions,
        left:x2,
        top:y2,
        angle:baseAngle
    }));
    if(mode==='double'){
        arrowParts.push(new fabric.Triangle({
            ...tipOptions,
            left:x1,
            top:y1,
            angle:baseAngle+180
        }));
    }
    const group=new fabric.Group(arrowParts,{
            selectable:true,
            evented:true,
            hasControls:true,
            hasBorders:true,
            lockScalingX:true,
            lockScalingY:true,
            padding:8,
            annotationType:mode==='double'?'doubleArrow':'arrow'
        });
    setArrowGroupAppearance(group,currentStrokeWidth,currentColor);
    return {group,angle};
}

function getActiveShapeKind(){
    if(activeTool==='highlight'){
        if(highlightMode==='box')return 'highlightBox';
        if(highlightMode==='ellipse')return 'highlightEllipse';
        return null;
    }
    if(SHAPE_TOOLS.includes(activeTool))return activeTool;
    return null;
}

function handleShapeStart(c,o){
    const shapeKind=getActiveShapeKind();
    if(!shapeKind)return;
    isShapeDrawing=true;shapeCanvas=c;
    currentShapeKind=shapeKind;
    const p=getCanvasScenePoint(c,o.e);
    shapeStart={x:p.x,y:p.y};

    c._suppressHistory=true;
    switch(shapeKind){
        case 'line':case 'arrow':
            tempShape=new fabric.Line([p.x,p.y,p.x,p.y],{
                strokeWidth:currentStrokeWidth,stroke:currentColor,fill:currentColor,
                originX:'center',originY:'center',selectable:false,evented:false,
                strokeUniform:true
            });
            c.add(tempShape);
            break;
        case 'rect':
            tempShape=new fabric.Rect({
                left:p.x,top:p.y,width:0,height:0,
                stroke:currentColor,strokeWidth:currentStrokeWidth,fill:getCurrentShapeFill(currentColor),
                selectable:false,evented:false,strokeUniform:true
            });
            c.add(tempShape);
            break;
        case 'circle':
            tempShape=new fabric.Ellipse({
                left:p.x,top:p.y,rx:0,ry:0,
                stroke:currentColor,strokeWidth:currentStrokeWidth,fill:getCurrentShapeFill(currentColor),
                selectable:false,evented:false,strokeUniform:true
            });
            c.add(tempShape);
            break;
        case 'cloud':
            tempShape=new fabric.Rect({
                left:p.x,top:p.y,width:0,height:0,
                stroke:currentColor,strokeWidth:currentStrokeWidth,fill:getCurrentShapeFill(currentColor),
                strokeDashArray:[5,5],selectable:false,evented:false,strokeUniform:true
            });
            c.add(tempShape);
            break;
        case 'highlightBox':
            // Temp shape is visible (opacity:1 + rgba fill) during drag for feedback.
            // finalizeShape flips to opacity:0 so the after:render composite takes over.
            // _hlTempShape flag stops normalizeHighlightVisual from zeroing the opacity
            // while the drag is still live.
            tempShape=new fabric.Rect({
                left:p.x,top:p.y,width:0,height:0,
                stroke:'transparent',strokeWidth:0,
                fill:getHighlightAreaFillColor(),
                selectable:false,evented:false,annotationType:'highlightBox',strokeUniform:true,
                opacity:1
            });
            tempShape._hlTempShape=true;
            c.add(tempShape);
            break;
        case 'highlightEllipse':
            tempShape=new fabric.Ellipse({
                left:p.x,top:p.y,rx:0,ry:0,
                stroke:'transparent',strokeWidth:0,
                fill:getHighlightAreaFillColor(),
                selectable:false,evented:false,annotationType:'highlightEllipse',strokeUniform:true,
                opacity:1
            });
            tempShape._hlTempShape=true;
            c.add(tempShape);
            break;
    }
    c._suppressHistory=false;
}

function handleShapeMove(o){
    if(!isShapeDrawing||!shapeCanvas||!tempShape)return;
    const p=getCanvasScenePoint(shapeCanvas,o.e);
    switch(currentShapeKind){
        case 'line':case 'arrow':
            tempShape.set({x2:p.x,y2:p.y});
            break;
        case 'rect':case 'cloud':case 'highlightBox':
            tempShape.set({
                left:Math.min(shapeStart.x,p.x),top:Math.min(shapeStart.y,p.y),
                width:Math.abs(p.x-shapeStart.x),height:Math.abs(p.y-shapeStart.y)
            });
            break;
        case 'circle':case 'highlightEllipse':
            tempShape.set({
                left:Math.min(shapeStart.x,p.x),top:Math.min(shapeStart.y,p.y),
                rx:Math.abs(p.x-shapeStart.x)/2,ry:Math.abs(p.y-shapeStart.y)/2
            });
            break;
    }
    shapeCanvas.renderAll();
}

function handleShapeEnd(){
    if(!isShapeDrawing||!shapeCanvas||!tempShape)return;
    isShapeDrawing=false;

    // Check minimum size
    let tooSmall=false;
    if(currentShapeKind==='line'||currentShapeKind==='arrow'){
        const d=Math.sqrt((tempShape.x2-tempShape.x1)**2+(tempShape.y2-tempShape.y1)**2);
        tooSmall=d<5;
    }else{
        const w=tempShape.width||(tempShape.rx?tempShape.rx*2:0);
        const h=tempShape.height||(tempShape.ry?tempShape.ry*2:0);
        tooSmall=w<5&&h<5;
    }
    if(tooSmall){
        shapeCanvas._suppressHistory=true;
        shapeCanvas.remove(tempShape);
        shapeCanvas._suppressHistory=false;
        shapeCanvas.renderAll();
        tempShape=null;shapeStart=null;shapeCanvas=null;currentShapeKind=null;
        return;
    }

    shapeCanvas._suppressHistory=true;
    switch(currentShapeKind){
        case 'line':{
            // Recreate the line from its final endpoints. Mutating x2/y2 on the
            // zero-length preview does not reliably refresh Fabric's dimensions,
            // leaving export with a one-point bounding box that crops to a dot.
            const x1=tempShape.x1,y1=tempShape.y1,x2=tempShape.x2,y2=tempShape.y2;
            shapeCanvas.remove(tempShape);
            const finishedLine=new fabric.Line([x1,y1,x2,y2],{
                strokeWidth:currentStrokeWidth,
                stroke:currentColor,
                fill:currentColor,
                strokeLineCap:'round',
                strokeUniform:true,
                selectable:true,
                evented:true,
                hasControls:true,
                hasBorders:true,
                padding:8,
                annotationType:'line'
            });
            finishedLine.setCoords();
            shapeCanvas.add(finishedLine);
            break;
        }
        case 'arrow':{
            const x1=tempShape.x1,y1=tempShape.y1,x2=tempShape.x2,y2=tempShape.y2;
            shapeCanvas.remove(tempShape);
            const arrowStyle=arrowMode==='double'?'double':'single';
            const builtArrow=createArrowGroup(x1,y1,x2,y2,arrowStyle);
            shapeCanvas.add(builtArrow.group);
            if(arrowMode==='note'){
                const labelOffset=Math.max(18,currentFontSize);
                const cosA=Math.cos(builtArrow.angle);
                const sinA=Math.sin(builtArrow.angle);
                const atTail=arrowNoteSide==='tail';
                // Offset away from the arrow: past the tip at the head end, behind the start at the tail end
                const dirX=atTail?-cosA:cosA;
                const dirY=atTail?-sinA:sinA;
                const pointsLeft=dirX<-0.1;
                const labelX=(atTail?x1:x2)+(dirX*labelOffset);
                const labelY=(atTail?y1:y2)+(dirY*labelOffset);
                const txt=new fabric.IText('',{
                    left:labelX,
                    top:labelY-(currentFontSize*0.6),
                    originX:pointsLeft?'right':'left',
                    fontFamily:currentFontFamily,
                    fontSize:currentFontSize,
                    fill:currentColor,
                    selectable:true,
                    evented:true
                });
                configureTextObjectRendering(txt);
                shapeCanvas.add(txt);
                shapeCanvas.setActiveObject(txt);
                txt.enterEditing();
                hasPendingTextEdits=true;
                hasUnsavedChanges=true;
            }
            break;
        }
        case 'rect':{
            // Fabric caches geometry for the zero-size preview that is added on
            // mouse-down. Updating width/height and calling setCoords() is not
            // sufficient in every Fabric 7 interaction path: point selection can
            // keep using the preview's empty hit area until a marquee selection
            // or another annotation interaction rebuilds the cache. Finalize with
            // a fresh object so its first hit-test has the completed dimensions.
            const finishedRect=new fabric.Rect({
                left:tempShape.left,top:tempShape.top,
                width:tempShape.width,height:tempShape.height,
                stroke:tempShape.stroke,strokeWidth:tempShape.strokeWidth,
                fill:tempShape.fill,
                strokeUniform:true,
                selectable:true,evented:true,
                hasControls:true,hasBorders:true,
                perPixelTargetFind:false,
                annotationType:'rect'
            });
            shapeCanvas.remove(tempShape);
            finishedRect.setCoords();
            shapeCanvas.add(finishedRect);
            break;
        }
        case 'circle':{
            const finishedEllipse=new fabric.Ellipse({
                left:tempShape.left,top:tempShape.top,
                rx:tempShape.rx,ry:tempShape.ry,
                stroke:tempShape.stroke,strokeWidth:tempShape.strokeWidth,
                fill:tempShape.fill,
                strokeUniform:true,
                selectable:true,evented:true,
                hasControls:true,hasBorders:true,
                perPixelTargetFind:false,
                annotationType:'circle'
            });
            shapeCanvas.remove(tempShape);
            finishedEllipse.setCoords();
            shapeCanvas.add(finishedEllipse);
            break;
        }
        case 'cloud':{
            const l=tempShape.left,t=tempShape.top,w=tempShape.width,h=tempShape.height;
            shapeCanvas.remove(tempShape);
            const cloud=createRevisionCloud(l,t,w,h);
            shapeCanvas.add(cloud);
            break;
        }
        case 'highlightBox':
        case 'highlightEllipse':{
            const finishedHL=tempShape;
            tempShape=null;
            delete finishedHL._hlTempShape;
            finishedHL._hlBaseColor=currentColor;
            finishedHL.set({
                fill:getHighlightAreaFillColor(currentColor),
                stroke:'transparent',
                strokeWidth:0,
                strokeUniform:true, opacity:0,
                objectCaching:false
            });
            finishedHL.dirty=true;
            finishedHL.setCoords();
            applyHighlightSelectability(finishedHL, activeTool==='select');
            break;
        }
    }
    shapeCanvas._suppressHistory=false;
    // Keep all objects locked while in shape/draw mode — only select tool unlocks them
    // But preserve active text editing (arrow+note mode)
    if(activeTool!=='select'){
        let hasEditingText=false;
        shapeCanvas.forEachObject(o=>{
            if(isTextObject(o)&&o.isEditing){hasEditingText=true;return;}
            o.selectable=false;o.evented=false;
        });
        if(!hasEditingText)shapeCanvas.discardActiveObject();
    }
    shapeCanvas.renderAll();
    saveCanvasState(shapeCanvas);
    tempShape=null;shapeStart=null;shapeCanvas=null;currentShapeKind=null;
}

// ─── TEXT PLACEMENT ─────────────────────────────────
function handleTextPlacement(c,o){
    if(activeTool!=='text'||o.target||textEditJustExited)return;
    activeContextPageNum=c._pageNum||currentVisiblePage;
    const p=getCanvasScenePoint(c,o.e);
    const txt=new fabric.IText('',{
        left:p.x,top:p.y,fontFamily:currentFontFamily,fontSize:currentFontSize,
        fill:currentColor,selectable:true,evented:true
    });
    configureTextObjectRendering(txt);
    c._suppressHistory=true;
    c.add(txt);
    c._suppressHistory=false;
    c.setActiveObject(txt);txt.enterEditing();
    hasPendingTextEdits=true;
    hasUnsavedChanges=true;
}

function getPdfTextLayerSpans(layer){
    return Array.from(layer&&layer.children||[]).filter(element=>
        element&&element.tagName==='SPAN'&&String(element.textContent||'').trim());
}

function findPdfTextSpanAtClientPoint(layer,clientX,clientY,padding=3){
    let best=null;
    let bestArea=Infinity;
    getPdfTextLayerSpans(layer).forEach(span=>{
        const rect=span.getBoundingClientRect();
        if(clientX<rect.left-padding||clientX>rect.right+padding||
            clientY<rect.top-padding||clientY>rect.bottom+padding)return;
        const area=Math.max(1,rect.width*rect.height);
        if(area<bestArea){best=span;bestArea=area;}
    });
    return best;
}

function stablePageTextSourceId(pageNumber,left,top,text){
    let hash=2166136261;
    for(const character of String(text||'')){
        hash^=character.codePointAt(0);
        hash=Math.imul(hash,16777619);
    }
    return `${pageNumber}:${Math.round(left*10)}:${Math.round(top*10)}:${(hash>>>0).toString(36)}`;
}

function getElementTransformInfo(element){
    const transform=getComputedStyle(element).transform;
    if(!transform||transform==='none')return {angle:0,scaleX:1};
    const match=/^matrix\(([^)]+)\)$/.exec(transform);
    if(!match)return {angle:0,scaleX:1};
    const values=match[1].split(',').map(Number);
    if(values.length!==6||values.some(value=>!Number.isFinite(value)))return {angle:0,scaleX:1};
    return {
        angle:Math.atan2(values[1],values[0])*180/Math.PI,
        scaleX:Math.max(0.01,Math.hypot(values[0],values[1]))
    };
}

async function ensurePdfTextLayerReadyForEditing(pageNumber,container){
    let layer=container.querySelector('.pdf-text-layer');
    for(let attempt=0;attempt<3&&layer&&!getPdfTextLayerSpans(layer).length;attempt++){
        await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    if(layer&&getPdfTextLayerSpans(layer).length)return layer;
    const page=await pdfDoc.getPage(pageNumber);
    if(layer)delete layer.dataset.viewportKey;
    const viewport=page.getViewport({scale});
    await renderPdfTextLayer(page,viewport,container,viewport.width,viewport.height);
    return container.querySelector('.pdf-text-layer');
}

async function handlePageTextPlacement(canvas,eventInfo){
    if(activeTool!=='pageText'||!canvas||!eventInfo||!eventInfo.e||canvas._pageTextPlacementBusy)return;
    canvas._pageTextPlacementBusy=true;
    const clientX=Number(eventInfo.e.clientX),clientY=Number(eventInfo.e.clientY);
    try{
        const pageNumber=canvas._pageNum||currentVisiblePage;
        const container=document.querySelector(`[data-page-num="${pageNumber}"]`);
        if(!container||!Number.isFinite(clientX)||!Number.isFinite(clientY))return;
        const layer=await ensurePdfTextLayerReadyForEditing(pageNumber,container);
        const span=findPdfTextSpanAtClientPoint(layer,clientX,clientY);
        if(!span){showMsg('No editable PDF text at that point (scanned text is an image)');return;}

        const scene=annotationPageSize(canvas);
        const layerWidth=Math.max(1,layer.offsetWidth||parseFloat(layer.style.width)||container.clientWidth||1);
        const layerHeight=Math.max(1,layer.offsetHeight||parseFloat(layer.style.height)||container.clientHeight||1);
        const style=getComputedStyle(span);
        const transform=getElementTransformInfo(span);
        const placement=window.EditorUtils.getPageTextReplacementPlacement({
            layerWidth,layerHeight,
            sceneWidth:scene.width,sceneHeight:scene.height,
            offsetLeft:span.offsetLeft,offsetTop:span.offsetTop,
            offsetWidth:Number(span.offsetWidth)||parseFloat(style.width)||8,
            transformScaleX:transform.scaleX,
            fontSize:parseFloat(style.fontSize)||Number(span.offsetHeight)||12,
            angle:transform.angle
        });
        const {left,top,width,fontSize}=placement;
        const originalText=String(span.textContent||'');
        const sourceId=stablePageTextSourceId(pageNumber,left,top,originalText);
        const existing=canvas.getObjects().find(object=>isPageTextReplacement(object)&&object.pageTextSourceId===sourceId);
        if(existing){
            canvas.setActiveObject(existing);
            if(typeof existing.enterEditing==='function')existing.enterEditing();
            canvas.requestRenderAll();
            return;
        }

        const replacement=new fabric.Textbox(originalText,{
            left,top,width,
            angle:placement.angle,
            fontFamily:'sans-serif',
            fontSize,
            lineHeight:1,
            fill:'#000000',
            backgroundColor:'#ffffff',
            padding:1,
            selectable:true,
            evented:true,
            annotationType:'pageTextReplacement',
            pageTextSourceId:sourceId,
            pageTextOriginal:originalText
        });
        configureTextObjectRendering(replacement);
        canvas._suppressHistory=true;
        canvas.add(replacement);
        canvas._suppressHistory=false;
        canvas.setActiveObject(replacement);
        replacement.enterEditing();
        replacement.selectionStart=0;
        replacement.selectionEnd=originalText.length;
        updateEditingTextLayout(replacement);
        hasPendingTextEdits=true;
        hasUnsavedChanges=true;
        canvas.requestRenderAll();
        showMsg('Replace the selected PDF text; delete this box to restore the original');
    }catch(error){
        console.error('PDF text edit failed:',error);
        showMsg('Could not edit that PDF text');
    }finally{
        canvas._pageTextPlacementBusy=false;
    }
}

function updateSelectedObjectProperties(){
    let updated=false;
    const context=getActiveSelectionContext();
    if(context&&context.objects.length>0){
        const textObjects=context.objects.filter(isTextObject);
        if(textObjects.length>0){
            textObjects.forEach(obj=>applyTextStyleToObject(obj,currentFontSize,currentFontFamily));
            context.canvas.requestRenderAll();
            saveCanvasState(context.canvas);
            updated=true;
        }
    }
    if(!updated){
        const candidates=[activeContextPageNum,currentVisiblePage];
        for(const pageNum of candidates){
            if(!Number.isFinite(pageNum))continue;
            const c=fabricCanvases.get(pageNum);
            if(!c)continue;
            const a=c.getActiveObject();
            if(a&&isTextObject(a)){
                applyTextStyleToObject(a,currentFontSize,currentFontFamily);
                c.requestRenderAll();
                saveCanvasState(c);
                updated=true;
                break;
            }
        }
    }
    if(updated)syncSizeControl();
}

// ─── PAGE INDICATOR ─────────────────────────────────
const _piEl=document.getElementById('pageIndicator');
const _cpnEl=document.getElementById('currentPageNum');
const _tpnEl=document.getElementById('totalPagesNum');
function updatePageIndicator(){
    const pi=_piEl, cpn=_cpnEl, tpn=_tpnEl;
    if(numPages>0){
        pi.classList.remove('hidden');
        cpn.textContent=currentVisiblePage;
        tpn.textContent=numPages;
        pi.style.opacity='1';
        if(pageIndicatorTimer)clearTimeout(pageIndicatorTimer);
        pageIndicatorTimer=setTimeout(()=>{
            pi.style.opacity='0';
            setTimeout(()=>pi.classList.add('hidden'),220);
        },4000);
    }else{pi.classList.add('hidden');}
    updatePageNavControls();
}

function updatePageNavControls(){
    if(!pageNavGroup||!pageJumpInput||!pageJumpTotal||!btnPrevPage||!btnNextPage)return;
    const hasPdf=numPages>0;
    pageNavGroup.classList.toggle('hidden',!hasPdf);
    if(!hasPdf)return;
    const pageValue=Math.max(1,Math.min(numPages,currentVisiblePage||1));
    pageJumpInput.value=String(pageValue);
    pageJumpInput.min='1';
    pageJumpInput.max=String(numPages);
    pageJumpTotal.textContent=String(numPages);
    btnPrevPage.disabled=pageValue<=1;
    btnNextPage.disabled=pageValue>=numPages;
}

function goToPage(pageNum){
    if(!numPages)return;
    const parsed=parseInt(pageNum,10);
    const target=Math.max(1,Math.min(numPages,Number.isFinite(parsed)?parsed:currentVisiblePage));
    const pageContainer=document.querySelector(`[data-page-num="${target}"]`);
    currentVisiblePage=target;
    activeContextPageNum=target;
    clearActiveSelectionsExcept(target);
    updatePageIndicator();
    if(pageContainer){
        if(!renderedPages.has(target)&&!renderingPages.has(target))renderPage(target,pageContainer);
        else if(renderedPages.has(target)&&pageContainer.dataset.pdfZoom!==getZoomKey(zoomFactor)){
            ensurePagePdfLayerAtCurrentZoom(target,pageContainer,true).catch(err=>{
                if(!isRenderCancelledError(err))console.error(`PDF rerender error page ${target}:`,err);
            });
        }
        pageContainer.scrollIntoView({behavior:'smooth',block:'start'});
    }
}

function getTargetPageWidth(viewportWidth){
    const viewerWidth=Math.max(320,pdfViewer.clientWidth-12);
    const fallbackWidth=Math.max(320,window.innerWidth-280);
    const targetWidth=(viewerWidth||fallbackWidth);
    const calculatedScale=targetWidth/viewportWidth;
    return Math.max(0.25,Math.min(5,calculatedScale*PAGE_SCALE_ADJUST));
}

function updateVisiblePage(){
    const mid=window.innerHeight/2;
    const viewerRect=pdfViewer.getBoundingClientRect();
    const sampleX=Math.max(0,Math.min(window.innerWidth-1,
        viewerRect.left+(Math.min(viewerRect.width,window.innerWidth)/2)));
    const hit=document.elementFromPoint(sampleX,mid);
    const hitPage=hit&&hit.closest&&hit.closest('.pdf-page-container');
    let closest=hitPage?parseInt(hitPage.dataset.pageNum,10):currentVisiblePage;

    // A page gap can be under the viewport midpoint. Check only the current
    // page and its immediate neighbors instead of forcing layout on every page.
    if(!hitPage){
        let closestDist=Infinity;
        for(let pageNum=Math.max(1,currentVisiblePage-2);pageNum<=Math.min(numPages,currentVisiblePage+2);pageNum++){
            const container=document.querySelector(`[data-page-num="${pageNum}"]`);
            if(!container)continue;
            const rect=container.getBoundingClientRect();
            const distance=Math.abs(rect.top+(rect.height/2)-mid);
            if(distance<closestDist){closestDist=distance;closest=pageNum;}
        }
    }
    if(closest!==currentVisiblePage){
        currentVisiblePage=closest;
        const currentCanvas=fabricCanvases.get(currentVisiblePage);
        if(!(currentCanvas&&currentCanvas.getActiveObject())){
            clearActiveSelectionsExcept(currentVisiblePage);
            activeContextPageNum=currentVisiblePage;
        }
        updatePageIndicator();
        syncSizeControl();
    }
    schedulePristinePageRelease();
}

function getZoomKey(value){
    return Number(value).toFixed(4);
}

function isRenderCancelledError(err){
    return !!err&&(err.name==='RenderingCancelledException'||/cancell?ed/i.test(err.message||''));
}

function cancelPageRenderTask(pageNum){
    const task=activePdfRenderTasks.get(pageNum);
    if(!task)return;
    try{task.cancel();}catch(e){}
    activePdfRenderTasks.delete(pageNum);
}

function cancelAllRenderTasks(){
    for(const [pageNum,task] of activePdfRenderTasks){
        try{task.cancel();}catch(e){}
        activePdfRenderTasks.delete(pageNum);
    }
}

async function renderPdfCanvasLayer(pageNum,page,pdfCanvas,viewport){
    if(!page||!pdfCanvas)return false;
    cancelPageRenderTask(pageNum);
    const task=page.render({canvasContext:pdfCanvas.getContext('2d'),viewport});
    activePdfRenderTasks.set(pageNum,task);
    try{
        await task.promise;
        return true;
    }catch(err){
        if(isRenderCancelledError(err))return false;
        throw err;
    }finally{
        if(activePdfRenderTasks.get(pageNum)===task)activePdfRenderTasks.delete(pageNum);
    }
}

// ─── CANVAS RENDERING ───────────────────────────────
const PDF_REFRESH_MARGIN_PX=900;

function isContainerNearViewport(container,margin=PDF_REFRESH_MARGIN_PX){
    if(!container)return false;
    const rect=container.getBoundingClientRect();
    return rect.bottom>=-margin&&rect.top<=(window.innerHeight+margin);
}

async function ensurePagePdfLayerAtCurrentZoom(pageNum,container,force=false){
    if(!pdfDoc||!container)return false;
    const desiredZoom=zoomFactor;
    const desiredKey=getZoomKey(desiredZoom);
    if(!force&&container.dataset.pdfZoom===desiredKey)return true;
    if(pendingPdfRefreshPages.has(pageNum))return false;

    const pdfCanvas=container.querySelector('.pdf-viewer-canvas');
    if(!pdfCanvas)return false;

    pendingPdfRefreshPages.add(pageNum);
    try{
        const page=await pdfDoc.getPage(pageNum);
        // Abort stale rerenders if zoom changed mid-flight.
        if(Math.abs(zoomFactor-desiredZoom)>0.001)return false;

        const dpr=window.devicePixelRatio||1;
        const viewport=page.getViewport({scale:scale*dpr});
        const textViewport=page.getViewport({scale});
        const displayWidth=viewport.width/dpr;
        const displayHeight=viewport.height/dpr;

        container.style.width=`${displayWidth}px`;
        container.style.height=`${displayHeight}px`;
        container.style.minHeight=`${displayHeight}px`;
        pdfCanvas.width=viewport.width;
        pdfCanvas.height=viewport.height;
        pdfCanvas.style.width=`${displayWidth}px`;
        pdfCanvas.style.height=`${displayHeight}px`;

        const didRender=await renderPdfCanvasLayer(pageNum,page,pdfCanvas,viewport);
        if(!didRender)return false;
        await renderPdfTextLayer(page,textViewport,container,displayWidth,displayHeight);
        if(Math.abs(zoomFactor-desiredZoom)<=0.001)container.dataset.pdfZoom=desiredKey;
        return true;
    }finally{
        pendingPdfRefreshPages.delete(pageNum);
    }
}

function getCachedPageTextContent(page){
    if(!page||typeof page.getTextContent!=='function')return Promise.reject(new Error('PDF page is required.'));
    if(!pageTextContentCache.has(page)){
        pageTextContentCache.set(page,page.getTextContent().catch(error=>{
            pageTextContentCache.delete(page);
            throw error;
        }));
    }
    return pageTextContentCache.get(page);
}

function scaleExistingPdfTextLayer(container,displayWidth,displayHeight){
    const layer=container&&container.querySelector('.pdf-text-layer');
    if(!layer)return;
    const baseWidth=Number(layer.dataset.baseWidth)||displayWidth;
    const baseHeight=Number(layer.dataset.baseHeight)||displayHeight;
    layer.style.width=`${baseWidth}px`;
    layer.style.height=`${baseHeight}px`;
    layer.style.transformOrigin='0 0';
    layer.style.transform=`scale(${displayWidth/baseWidth},${displayHeight/baseHeight})`;
}

// Render a text layer over a PDF page. Spans are positioned to match the
// rendered canvas exactly so the browser's native Ctrl+F highlights line up.
// Uses pdfjsLib.renderTextLayer when available (PDF.js 3.x) and falls back
// to manual span positioning otherwise. The layer is reused across re-renders.
async function renderPdfTextLayer(pg, viewport, container, displayWidth, displayHeight){
    let textLayerDiv=container.querySelector('.pdf-text-layer');
    const viewportKey=`${viewport.width.toFixed(2)}x${viewport.height.toFixed(2)}@${viewport.rotation||0}`;
    if(textLayerDiv&&textLayerDiv.dataset.viewportKey===viewportKey){
        textLayerDiv.style.width=`${displayWidth}px`;
        textLayerDiv.style.height=`${displayHeight}px`;
        return;
    }
    if(!textLayerDiv){
        textLayerDiv=document.createElement('div');
        textLayerDiv.className='pdf-text-layer';
        container.appendChild(textLayerDiv);
    }else{
        textLayerDiv.replaceChildren();
    }
    textLayerDiv.dataset.viewportKey=viewportKey;
    textLayerDiv.dataset.baseWidth=String(displayWidth);
    textLayerDiv.dataset.baseHeight=String(displayHeight);
    textLayerDiv.style.width=`${displayWidth}px`;
    textLayerDiv.style.height=`${displayHeight}px`;
    textLayerDiv.style.transform='none';

    const textContent=await getCachedPageTextContent(pg);
    // Prefer PDF.js's built-in helper if it exists (handles RTL, ligatures, etc.)
    if(typeof pdfjsLib.renderTextLayer==='function'){
        const task=pdfjsLib.renderTextLayer({
            textContent,
            container:textLayerDiv,
            viewport,
            textDivs:[],
        });
        // PDF.js 3.x returns a task object with a `.promise` field
        if(task&&task.promise)await task.promise;
        return;
    }
    // Manual fallback
    const Util=pdfjsLib.Util;
    const frag=document.createDocumentFragment();
    for(const item of textContent.items){
        if(!item.str)continue;
        const tx=Util?Util.transform(viewport.transform,item.transform):item.transform;
        const fontHeight=Math.hypot(tx[2],tx[3]);
        const span=document.createElement('span');
        span.textContent=item.str;
        span.style.left=`${tx[4]}px`;
        span.style.top=`${tx[5]-fontHeight}px`;
        span.style.fontSize=`${fontHeight}px`;
        span.style.fontFamily=item.fontName||'sans-serif';
        frag.appendChild(span);
    }
    textLayerDiv.appendChild(frag);
}

// Eagerly build text-only layers for every page on document load so Ctrl+F
// can find text in pages the user hasn't scrolled to yet. Skips canvas
// rasterisation — text extraction alone is cheap (~10-50 ms per page).
function getSearchTextFromContent(textContent){
    return Array.from(textContent&&textContent.items||[])
        .map(item=>String(item&&item.str||'').trim())
        .filter(Boolean)
        .join(' ');
}

// Keep Ctrl+F coverage for pages that have not been rendered without building
// a positioned DOM span for every PDF text fragment. One lightweight text node
// per page is enough to make native find scroll to that page; the precise text
// layer replaces it when the page is actually rendered.
function attachSearchTextProxy(pageNum,text){
    const normalized=String(text||'').trim();
    if(!normalized)return;
    searchTextByPage.set(pageNum,normalized);
    const container=document.querySelector(`[data-page-num="${pageNum}"]`);
    if(!container||container.querySelector('.pdf-text-layer'))return;
    let proxy=container.querySelector('.pdf-search-text-proxy');
    if(!proxy){
        proxy=document.createElement('div');
        proxy.className='pdf-search-text-proxy';
        container.appendChild(proxy);
    }
    proxy.textContent=normalized;
}

function isForegroundRenderingBusy(){
    return renderingPages.size>0||activePdfRenderTasks.size>0||pendingPdfRefreshPages.size>0;
}

async function waitForForegroundRendering(runId,documentToAnalyze){
    while(runId===specialStudAnalysisRun&&pdfDoc===documentToAnalyze){
        while(isForegroundRenderingBusy()){
            await new Promise(resolve=>setTimeout(resolve,40));
            if(runId!==specialStudAnalysisRun||pdfDoc!==documentToAnalyze)break;
        }
        if(runId!==specialStudAnalysisRun||pdfDoc!==documentToAnalyze)break;
        await new Promise(resolve=>{
            if(typeof requestIdleCallback==='function')requestIdleCallback(()=>resolve(),{timeout:200});
            else setTimeout(resolve,0);
        });
        // A page may have entered the render window while we waited for idle.
        if(!isForegroundRenderingBusy())return;
    }
    throw new DOMException('Background PDF scan cancelled.','AbortError');
}

async function renderPage(n,containerOverride=null){
    let cont=null;
    let markedRendering=false;
    try{
        if(renderedPages.has(n)||renderingPages.has(n))return null;
        renderingPages.add(n);
        markedRendering=true;
        const pg=await pdfDoc.getPage(n),vp=pg.getViewport({scale:1});
        pageViewportCache.set(n,{width:vp.width,height:vp.height});
        if(baseScale===null){
            baseScale=getTargetPageWidth(vp.width);
        }
        scale=baseScale;
        const dpr=window.devicePixelRatio||1;
        const rv=pg.getViewport({scale:scale*dpr});
        const textViewport=pg.getViewport({scale});
        const dw=rv.width/dpr,dh=rv.height/dpr;
        defaultPageSize={w:dw,h:dh};

        cont=containerOverride||document.querySelector(`[data-page-num="${n}"]`)||document.createElement('div');
        cont.className='pdf-page-container';
        cont.style.width=`${dw}px`;cont.style.height=`${dh}px`;cont.style.minHeight='0px';
        cont.dataset.pageNum=n;cont.innerHTML='';

        const pdfC=document.createElement('canvas');
        pdfC.className='pdf-viewer-canvas';
        pdfC.width=rv.width;pdfC.height=rv.height;
        pdfC.style.width=`${dw}px`;pdfC.style.height=`${dh}px`;
        cont.appendChild(pdfC);
        const didRenderPdf=await renderPdfCanvasLayer(n,pg,pdfC,rv);
        if(!didRenderPdf)return null;

        if(!cont.parentElement)pdfViewer.appendChild(cont);

        // Start the native Ctrl+F layer without making annotation interaction
        // wait for every text fragment to be positioned.
        void renderPdfTextLayer(pg,textViewport,cont,dw,dh)
            .catch(e=>console.debug('text layer failed',n,e));

        const fabEl=document.createElement('canvas');
        fabEl.id=`fabric-canvas-${n}`;
        fabEl.style.position='absolute';fabEl.style.top='0';fabEl.style.left='0';
        cont.appendChild(fabEl);

        const fc=new fabric.Canvas(fabEl,{selection:true,isDrawingMode:false,width:dw,height:dh});
        fc._pageNum=n;
        fc._lastSavedState=getSerializedCanvasState(fc);
        fc.selectionFullyContained=false;
        fc.targetFindTolerance=15;
        // Use object bounds for interaction. Pixel-only hit testing makes thin
        // annotations appear selected but prevents dragging unless the next
        // pointer-down lands on the exact painted pixels (especially lines,
        // arrows, paths, and transparent highlight objects).
        fc.perPixelTargetFind=false;
        fc._historySeeded=false;
        if(!savedStateByPage.has(n))savedStateByPage.set(n,fc._lastSavedState);

        fc.freeDrawingBrush=new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color=currentColor;
        fc.freeDrawingBrush.width=currentStrokeWidth;

        fc.on('object:moving',(e)=>{
            const obj=e.target;
            if(!obj)return;
            const vpt=fc.viewportTransform||[1,0,0,1,0,0];
            const cW=fc.width/(vpt[0]||1), cH=fc.height/(vpt[3]||1);
            const oW=(obj.getScaledWidth?obj.getScaledWidth():(obj.width||0));
            const oH=(obj.getScaledHeight?obj.getScaledHeight():(obj.height||0));
            // Account for object origin (center vs left/top)
            const ox=obj.originX==='center'?oW/2:obj.originX==='right'?oW:0;
            const oy=obj.originY==='center'?oH/2:obj.originY==='bottom'?oH:0;
            // Clamp: left edge >= 0, right edge <= cW
            const effectiveLeft=obj.left-ox;
            const effectiveTop=obj.top-oy;
            if(effectiveLeft<0)obj.left=ox;
            else if(effectiveLeft+oW>cW)obj.left=cW-oW+ox;
            if(effectiveTop<0)obj.top=oy;
            else if(effectiveTop+oH>cH)obj.top=cH-oH+oy;
        });

        fc.on('object:modified',(e)=>{
            if(!fc._restoring) saveCanvasState(fc);
            syncSizeControl();
        });

        // Flat highlight compositing — see compositeHighlightLayer.
        // Fabric's own pass draws highlights at opacity:0 (nothing visible);
        // this hook paints the merged flat region once per frame.
        fc.on('after:render',event=>{
            // Fabric fires after:render for both the lower scene canvas and
            // the interactive top canvas. Top-canvas renders happen many
            // times during a pointer drag and do not clear the lower canvas;
            // painting there again made highlights progressively darker.
            if(event&&event.ctx&&event.ctx!==fc.contextContainer)return;
            compositeHighlightLayer(fc, fc.contextContainer, {
                destWidth:fc.lowerCanvasEl.width,
                destHeight:fc.lowerCanvasEl.height,
                transform:getLiveCanvasRenderTransform(fc)
            });
        });

        fc.on('object:added',e=>{
            const obj=e&&e.target;
            if(!obj)return;
            ensureDraftAnnotationId(obj);
            if(isHighlightLayerObject(obj)){
                normalizeHighlightVisual(obj);
                applyHighlightSelectability(obj, activeTool==='select');
            }
            if(isTextObject(obj))configureTextObjectRendering(obj);
            if(!isArrowGroup(obj))return;
            obj.set({lockScalingX:true,lockScalingY:true});
            const line=(obj._objects||[]).find(p=>isFabricType(p,'line'));
            const strokeColor=(line&&line.stroke)||currentColor;
            setArrowGroupAppearance(obj,getStrokeWidthForObject(obj),strokeColor);
        });

        fc.on('path:created',e=>{
            if(e.path){
                const canSelect=activeTool==='select';
                e.path.set({selectable:canSelect,evented:canSelect,hasControls:true,hasBorders:true,strokeUniform:true,padding:8});
                if(activeTool==='highlight'&&highlightMode==='pen'){
                    e.path._hlBaseColor=currentColor;
                    e.path.set({
                        annotationType:'highlightPen',
                        stroke:getHighlightBrushColor(currentColor),
                        fill:'',
                        opacity:0,
                        strokeLineCap:'round',
                        strokeLineJoin:'round',
                        objectCaching:false
                    });
                    e.path.dirty=true;
                    applyHighlightSelectability(e.path, canSelect);
                }
            }
            saveCanvasState(fc);
            fc.requestRenderAll();
        });

        fc.on('text:editing:entered',()=>{
            if(suppressTextEditingLifecycle){
                activeContextPageNum=fc._pageNum;
                hasPendingTextEdits=true;
                hasUnsavedChanges=true;
                syncSizeControl();
                return;
            }
            activeContextPageNum=fc._pageNum;
            clearActiveSelectionsExcept(fc._pageNum);
            hasPendingTextEdits=true;
            hasUnsavedChanges=true;
            syncSizeControl();
        });

        fc.on('text:editing:exited',()=>{
            if(suppressTextEditingLifecycle){
                const activeObj=fc.getActiveObject();
                if(activeObj&&isTextObject(activeObj))configureTextObjectRendering(activeObj);
                syncSizeControl();
                return;
            }
            textEditJustExited=true;
            setTimeout(()=>{textEditJustExited=false;},200);
            const empties=fc.getObjects().filter(o=>isTextObject(o)&&!o.text.trim());
            fc._suppressHistory=true;
            empties.forEach(o=>fc.remove(o));
            fc._suppressHistory=false;
            if(empties.length>0)fc.renderAll();
            // Keep only the objects belonging to the active editing mode live.
            fc.forEachObject(o=>applyObjectInteractivity(o));
            const activeObj=fc.getActiveObject();
            if(activeObj&&!isObjectEditableForTool(activeObj))fc.discardActiveObject();
            fc.renderAll();
            saveCanvasState(fc);
        });

        fc.on('selection:created',()=>{
            activeContextPageNum=fc._pageNum;
            clearActiveSelectionsExcept(fc._pageNum);
            syncSizeControl();
        });
        fc.on('selection:updated',()=>{
            activeContextPageNum=fc._pageNum;
            clearActiveSelectionsExcept(fc._pageNum);
            syncSizeControl();
        });
        fc.on('selection:cleared',()=>{
            if(activeContextPageNum===fc._pageNum)activeContextPageNum=currentVisiblePage;
            syncSizeControl();
        });

        fc.on('mouse:down',o=>{
            fc.calcOffset();
            activeContextPageNum=fc._pageNum;
            if(o.e.button===2){
                isPanning=true;panStartX=o.e.clientX-panOffsetX;panStartY=o.e.clientY-panOffsetY;fc.defaultCursor='grabbing';
            }else if(isShapeModeTool(activeTool)||isFreeDrawModeTool(activeTool)){
                // In drawing/shape mode: ignore existing objects, always start new shape
                if(o.target){fc.discardActiveObject();fc.renderAll();}
                if(isShapeModeTool(activeTool)) handleShapeStart(fc,o);
            }else if(!o.target){
                if(activeTool==='text') handleTextPlacement(fc,o);
                else if(activeTool==='pageText')void handlePageTextPlacement(fc,o);
            }
        });

        fc.on('mouse:move',o=>{
            if(isPanning){
                panOffsetX=o.e.clientX-panStartX;panOffsetY=o.e.clientY-panStartY;
                pdfViewer.style.transform=`translate(${panOffsetX}px,${panOffsetY}px)`;
            }else handleShapeMove(o);
            if(!isPanning){
                const ptr=getCanvasScenePoint(fc,o.e);
                lastCanvasMousePos={pageNum:fc._pageNum,x:ptr.x,y:ptr.y};
            }
        });

        fc.on('mouse:up',o=>{
            if(isPanning)stopPanning();
            else handleShapeEnd();
        });

        cont.addEventListener('contextmenu',e=>e.preventDefault());

        fabricCanvases.set(n,fc);
        // Objects live in fitScale-relative coords (independent of zoomFactor).
        // _renderFitScale = fitScale when canvas was created; vpt = baseScale / _renderFitScale.
        fc._renderFitScale=baseScale/zoomFactor;
        fc.setViewportTransform([zoomFactor,0,0,zoomFactor,0,0]);
        // Lightweight init for this canvas only (no showMsg, no reconfiguring all canvases)
        fc.selection=activeTool==='select';
        fc.isDrawingMode=isFreeDrawModeTool(activeTool);
        if(activeTool==='draw'){
            fc.freeDrawingBrush=new fabric.PencilBrush(fc);
            fc.freeDrawingBrush.color=currentColor;
            fc.freeDrawingBrush.width=currentStrokeWidth;
        }else if(activeTool==='highlight'&&highlightMode==='pen'){
            configureHighlightBrush(fc);
        }
        fc.defaultCursor=getCursorForTool(activeTool);
        fc.calcOffset();
        const pendingEmbeddedPage=pendingEmbeddedPageAnnotations.get(n);
        if(pendingEmbeddedPage){
            pendingEmbeddedPageAnnotations.delete(n);
            await restoreEmbeddedPageAnnotations(fc,pendingEmbeddedPage);
        }
        const pendingDraftJson=pendingDraftPageAnnotations.get(n);
        if(pendingDraftJson){
            pendingDraftPageAnnotations.delete(n);
            await applyDraftAnnotationsToCanvas(fc,n,pendingDraftJson);
        }
        renderedPages.add(n);
        cont.style.minHeight=`${dh}px`;
        cont.dataset.rendered='true';
        cont.dataset.pdfZoom=getZoomKey(zoomFactor);
        return {width:dw,height:dh};
    }catch(err){console.error(`Error page ${n}:`,err);}
    finally{if(markedRendering)renderingPages.delete(n);}
}

async function disposeAllFabricCanvases(){
    const tasks=[];
    fabricCanvases.forEach(canvas=>{
        try{tasks.push(Promise.resolve(canvas.dispose()));}catch(error){console.debug('Canvas dispose failed',error);}
    });
    if(tasks.length)await Promise.allSettled(tasks);
}

async function renderAllPages(){
    if(!pdfDoc)return;
    cancelAllRenderTasks();
    queuedZoomFactor=null;
    zoomWorkerActive=false;
    await disposeAllFabricCanvases();
    pdfViewer.innerHTML='';
    if(pageRenderObserver)pageRenderObserver.disconnect();
    pageRenderObserver=null;renderedPages.clear();renderingPages.clear();fabricCanvases.clear();
    pageViewportCache.clear();
    pageTextContentCache=new WeakMap();
    searchTextByPage.clear();
    pendingEmbeddedPageAnnotations.clear();
    pendingDraftPageAnnotations.clear();
    savedStateByPage.clear();historyStack.length=0;historyPointer=-1;historyTotalBytes=0;historyRestoreInProgress=false;hasPendingTextEdits=false;hasUnsavedChanges=false;
    isPanning=false;panOffsetX=0;panOffsetY=0;pdfViewer.style.transform='translate(0,0)';
    currentVisiblePage=1;activeContextPageNum=1;baseScale=null;zoomFactor=1.0;updateZoomDisplay();
    let ph=defaultPageSize.h||800;
    const eager=Math.min(1,numPages);

    for(let i=1;i<=numPages;i++){
        const cont=document.createElement('div');
        cont.className='pdf-page-container';cont.dataset.pageNum=i;
        cont.style.minHeight=`${ph}px`;
        cont.innerHTML='<div class="text-sm text-gray-400 py-6 text-center">Loading page...</div>';
        pdfViewer.appendChild(cont);
        if(i<=eager){const dims=await renderPage(i,cont);if(dims)ph=dims.height;}
    }

    pageRenderObserver=new IntersectionObserver(entries=>{
        entries.forEach(entry=>{
            if(entry.isIntersecting){
                const pNum=parseInt(entry.target.dataset.pageNum,10);
                if(!renderedPages.has(pNum)&&!renderingPages.has(pNum)){
                    renderPage(pNum,entry.target);
                }else if(renderedPages.has(pNum)&&entry.target.dataset.pdfZoom!==getZoomKey(zoomFactor)){
                    ensurePagePdfLayerAtCurrentZoom(pNum,entry.target).catch(err=>{
                        if(!isRenderCancelledError(err))console.error(`PDF rerender error page ${pNum}:`,err);
                    });
                }
            }
        });
    },{root:null,rootMargin:'200px 0px',threshold:0.05});

    document.querySelectorAll('.pdf-page-container').forEach(el=>{
        pageRenderObserver.observe(el);
    });
    updatePageIndicator();
}

// ─── PDF LOAD / SAVE ────────────────────────────────
function resetSpecialStudAnalysis(message='Scanning PDF text for special studs...'){
    specialStudAnalysisRows=[];
    if(specialStudStatus){
        specialStudStatus.textContent=message;
        specialStudStatus.classList.remove('error');
    }
    if(specialStudResults)specialStudResults.hidden=true;
    if(btnExportSpecialStudCsv)btnExportSpecialStudCsv.disabled=true;
}

function appendSpecialStudCell(row,value){
    const cell=document.createElement('td');
    cell.textContent=value;
    row.appendChild(cell);
}

function renderSpecialStudAnalysis(rows){
    const analyzer=window.SpecialStudAnalyzer;
    const summary=analyzer.summarizeRows(rows);
    specialStudAnalysisRows=rows.slice();
    specialStudStatus.classList.remove('error');
    if(!summary.rowCount){
        specialStudStatus.textContent='No 16, 14, or 12 gauge stud or track rows were found. Flat straps are excluded.';
        specialStudResults.hidden=true;
        btnExportSpecialStudCsv.disabled=true;
        return;
    }

    specialStudStatus.textContent=`Found ${summary.rowCount} special stud/track cut-list rows. Flat straps are excluded.`;
    specialStudPieceCount.textContent=summary.quantity.toLocaleString();
    specialStudTypeCount.textContent=summary.typeCount.toLocaleString();
    specialStudWeight.textContent=summary.weightLb.toFixed(1);
    specialStudRowCount.textContent=summary.rowCount.toLocaleString();

    specialStudGaugeSummary.replaceChildren();
    summary.byGauge.forEach(item=>{
        const gaugeRow=document.createElement('div');
        gaugeRow.className='special-stud-gauge';
        const label=document.createElement('strong');
        label.textContent=`${item.gauge} GA / ${item.thicknessMil} mil`;
        const values=document.createElement('span');
        values.textContent=`${item.quantity} pcs | ${item.weightLb.toFixed(1)} lb`;
        gaugeRow.append(label,values);
        specialStudGaugeSummary.appendChild(gaugeRow);
    });

    specialStudRows.replaceChildren();
    rows.forEach(item=>{
        const tableRow=document.createElement('tr');
        appendSpecialStudCell(tableRow,`${item.gauge} / ${item.type}`);
        appendSpecialStudCell(tableRow,item.panel);
        appendSpecialStudCell(tableRow,String(item.quantity));
        appendSpecialStudCell(tableRow,item.cutLength);
        specialStudRows.appendChild(tableRow);
    });
    specialStudResults.hidden=false;
    btnExportSpecialStudCsv.disabled=false;
}

async function runSpecialStudAnalysis(documentToAnalyze){
    const analyzer=window.SpecialStudAnalyzer;
    if(!analyzer){
        if(specialStudStatus){
            specialStudStatus.textContent='Special stud analyzer failed to load.';
            specialStudStatus.classList.add('error');
        }
        return;
    }
    const runId=++specialStudAnalysisRun;
    resetSpecialStudAnalysis();
    try{
        const rows=await analyzer.analyzePdfDocument(documentToAnalyze,(page,total)=>{
            if(runId!==specialStudAnalysisRun)return;
            specialStudStatus.textContent=`Scanning page ${page} of ${total} for special studs...`;
        },async(pageNumber,page)=>{
            // Visible page rendering always wins over the optional full-document
            // material scan and native-find indexing.
            await waitForForegroundRendering(runId,documentToAnalyze);
            const textContent=await getCachedPageTextContent(page);
            attachSearchTextProxy(pageNumber,getSearchTextFromContent(textContent));
            return textContent;
        });
        if(runId!==specialStudAnalysisRun||pdfDoc!==documentToAnalyze)return;
        renderSpecialStudAnalysis(rows);
    }catch(error){
        if(runId!==specialStudAnalysisRun)return;
        console.error('Special stud analysis failed:',error);
        specialStudStatus.textContent=`Special stud scan failed: ${error.message||error}`;
        specialStudStatus.classList.add('error');
        specialStudResults.hidden=true;
    }
}

function scheduleSpecialStudAnalysis(documentToAnalyze){
    clearTimeout(specialStudAnalysisTimer);
    specialStudAnalysisTimer=setTimeout(()=>{
        specialStudAnalysisTimer=null;
        if(pdfDoc===documentToAnalyze)void runSpecialStudAnalysis(documentToAnalyze);
    },400);
}

function exportSpecialStudCsv(){
    if(!specialStudAnalysisRows.length||!window.SpecialStudAnalyzer)return;
    const csv=window.SpecialStudAnalyzer.rowsToReportCsv(specialStudAnalysisRows);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const sourceBase=(currentFileName||'special-studs').replace(/\.pdf$/i,'');
    const link=document.createElement('a');
    link.href=URL.createObjectURL(blob);
    link.download=`${sourceBase}_special_studs.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),0);
    showMsg('Special stud CSV exported');
}

if(btnExportSpecialStudCsv)btnExportSpecialStudCsv.addEventListener('click',exportSpecialStudCsv);

async function loadPDF(f){
    const ini=document.getElementById('initialMessage');
    if(ini)ini.style.display='none';
    if(loadingOverlay)loadingOverlay.classList.remove('hidden');
    btnSavePdf.disabled=true;
    specialStudAnalysisRun+=1;
    clearTimeout(specialStudAnalysisTimer);
    specialStudAnalysisTimer=null;
    resetSpecialStudAnalysis();
    try{
        if(pdfDoc){
            cancelAllRenderTasks();
            pdfDoc.destroy();
            pdfDoc=null;
        }
        currentFileName=f.name;
        document.getElementById('fileName').textContent=currentFileName;
        document.getElementById('fileNameDisplay').classList.remove('hidden');
        document.getElementById('fileNameDisplay').classList.add('flex');
        const ab=await f.arrayBuffer();
        const uploadedPdfBytes=new Uint8Array(ab);
        originalPdfBytes=uploadedPdfBytes;
        // Pass a copy to pdf.js - it transfers the ArrayBuffer ownership,
        // which would detach originalPdfBytes and break pdf-lib on save.
        // isEvalSupported:false blocks the CVE-2024-4367 eval path (malicious
        // font matrices executing JS) on pdf.js builds older than 4.2.67.
        pdfDoc=await pdfjsLib.getDocument({data:originalPdfBytes.slice(),isEvalSupported:false}).promise;
        let embeddedState=null;
        let nativeDescriptors=[];
        let embeddedWarning='';
        try{
            embeddedState=await readEmbeddedAnnotationState(pdfDoc);
            if(embeddedState&&embeddedState.mode==='legacy'){
                const sourceProxy=await pdfjsLib.getDocument({data:embeddedState.sourcePdfBytes.slice(),isEvalSupported:false}).promise;
                const expectedPages=Number(embeddedState.payload.source&&embeddedState.payload.source.pageCount);
                if(Number.isInteger(expectedPages)&&expectedPages>0&&sourceProxy.numPages!==expectedPages){
                    await sourceProxy.destroy();
                    throw new Error('The embedded source PDF does not match its annotation data.');
                }
                const wrapperProxy=pdfDoc;
                pdfDoc=sourceProxy;
                originalPdfBytes=embeddedState.sourcePdfBytes;
                try{await wrapperProxy.destroy();}catch(error){console.debug('PDF wrapper cleanup failed',error);}
            }else if(embeddedState&&embeddedState.mode==='native'){
                const editablePdf=await createNativeEditingPdf(uploadedPdfBytes);
                const displayProxy=await pdfjsLib.getDocument({data:editablePdf.displayBytes.slice(),isEvalSupported:false}).promise;
                const wrapperProxy=pdfDoc;
                pdfDoc=displayProxy;
                nativeDescriptors=editablePdf.descriptors;
                originalPdfBytes=uploadedPdfBytes;
                try{await wrapperProxy.destroy();}catch(error){console.debug('PDF wrapper cleanup failed',error);}
            }
        }catch(error){
            console.warn('Embedded DraftAnnotator data could not be restored:',error);
            embeddedState=null;
            originalPdfBytes=uploadedPdfBytes;
            embeddedWarning=` Embedded editable data could not be restored: ${error.message||'unknown error'}`;
        }
        numPages=pdfDoc.numPages;
        await renderAllPages();
        const restoredCount=embeddedState?await hydrateEmbeddedAnnotations(embeddedState.payload,nativeDescriptors):0;
        const saveLibrariesReady=!!(window.PDFLib&&window.NativeAnnotationUtils&&window.EmbeddedAnnotationUtils);
        btnSavePdf.disabled=!saveLibrariesReady;recomputeUnsavedChanges();
        if(!saveLibrariesReady)embeddedWarning+=' Save unavailable: annotation library missing. Reload the page and try again.';
        showMsg(embeddedState
            ?`PDF loaded: ${restoredCount} editable annotation(s) restored${embeddedWarning}`
            :`PDF loaded: ${numPages} page(s).${embeddedWarning}`);
        scheduleSpecialStudAnalysis(pdfDoc);
    }catch(e){
        console.error('Load err:',e);
        await disposeAllFabricCanvases();
        fabricCanvases.clear();renderedPages.clear();renderingPages.clear();
        pendingEmbeddedPageAnnotations.clear();savedStateByPage.clear();historyStack.length=0;historyPointer=-1;historyTotalBytes=0;
        specialStudAnalysisRun+=1;
        resetSpecialStudAnalysis('Special stud scan unavailable because the PDF did not load.');
        const errDiv=document.createElement('div');errDiv.className='text-red-600 p-8';errDiv.textContent='Error: '+e.message;pdfViewer.innerHTML='';pdfViewer.appendChild(errDiv);
        btnSavePdf.disabled=true;
    }finally{
        if(loadingOverlay)loadingOverlay.classList.add('hidden');
        fileInput.value='';
    }
}

function normalizeRotationAngle(angle){
    const rounded=Math.round(angle||0);
    const rot=((rounded%360)+360)%360;
    return (rot===90||rot===180||rot===270)?rot:0;
}

// Two device-independent pixels per display pixel is a good print-quality/file-size
// balance. The resulting bitmap is cropped to non-transparent bounds before embed.
const SAVE_OVERLAY_SCALE=2;

function canvasToPngBytes(canvas){
    const dataUrl=canvas.toDataURL('image/png');
    const idx=dataUrl.indexOf(',');
    const b64=idx>=0?dataUrl.slice(idx+1):'';
    const bin=atob(b64);
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return bytes;
}

function getExportSourceCanvas(fc,multiplier=1){
    // Prefer fabric's export path so vectors/text are rerendered at higher resolution.
    // NOTE: caller must reset viewport transform to identity before calling this.
    // Highlights are stored with opacity:0 — Fabric's native export draws nothing
    // for them. We layer them in via compositeHighlightLayer so the exported PDF
    // has the same flat-marker look as the screen.
    let baseCanvas=null;
    try{
        if(fc&&typeof fc.toCanvasElement==='function'){
            const exported=fc.toCanvasElement(multiplier);
            if(exported&&exported.width&&exported.height)baseCanvas=exported;
        }
    }catch(e){}
    if(!baseCanvas)baseCanvas=fc?fc.lowerCanvasEl:null;
    if(!baseCanvas)return null;
    // Paint the flat highlight layer on top of the exported base canvas.
    const hasHighlights=fc&&fc.getObjects().some(o=>isHighlightLayerObject(o)&&!o._hlTempShape);
    if(hasHighlights){
        const ctx=baseCanvas.getContext('2d');
        if(ctx){
            compositeHighlightLayer(fc, ctx, {
                destWidth:baseCanvas.width,
                destHeight:baseCanvas.height,
                // toCanvasElement scales by multiplier internally; mirror that here
                transform:[multiplier,0,0,multiplier,0,0]
            });
        }
    }
    return baseCanvas;
}

function buildNormalizedOverlayCanvas(fc,rotation,multiplier=SAVE_OVERLAY_SCALE){
    const src=getExportSourceCanvas(fc,multiplier);
    if(!src||!src.width||!src.height)return null;

    const rot=normalizeRotationAngle(rotation);
    const out=document.createElement('canvas');
    if(rot===90||rot===270){
        out.width=src.height;
        out.height=src.width;
    }else{
        out.width=src.width;
        out.height=src.height;
    }
    const ctx=out.getContext('2d');
    if(!ctx)return null;

    // Convert from viewer orientation back to the page's raw orientation.
    switch(rot){
        case 90:
            ctx.translate(0,out.height);
            ctx.rotate(-Math.PI/2);
            break;
        case 180:
            ctx.translate(out.width,out.height);
            ctx.rotate(Math.PI);
            break;
        case 270:
            ctx.translate(out.width,0);
            ctx.rotate(Math.PI/2);
            break;
    }
    ctx.drawImage(src,0,0);
    return out;
}

const _colorParseCtx=document.createElement('canvas').getContext('2d');

function mapDisplayPointToPdf(displayPoint,rot,pxW,pxH,boxX,boxY,boxW,boxH){
    const nx=pxW?displayPoint.x/pxW:0;
    const ny=pxH?displayPoint.y/pxH:0;
    switch(rot){
        case 90:  return {x:boxX+(ny*boxW),     y:boxY+(nx*boxH)};
        case 180: return {x:boxX+((1-nx)*boxW), y:boxY+(ny*boxH)};
        case 270: return {x:boxX+((1-ny)*boxW), y:boxY+((1-nx)*boxH)};
        default:  return {x:boxX+(nx*boxW),     y:boxY+((1-ny)*boxH)};
    }
}

function nativeDescriptorSnapshot(descriptor){
    const snapshot={};
    for(const key of ['id','pageIndex','kind','rect','color','fillColor','opacity','width','contents','fontSize','alignment','line','inkLists','vertices','lineEndings']){
        if(descriptor[key]!==undefined)snapshot[key]=descriptor[key];
    }
    return snapshot;
}

function parseCssColor(color,defaultColor=[0,0,0]){
    try{
        _colorParseCtx.fillStyle='#000000';
        _colorParseCtx.fillStyle=color||'#000000';
        const normalized=_colorParseCtx.fillStyle;
        if(/^#[0-9a-f]{6}$/i.test(normalized)){
            return [
                parseInt(normalized.slice(1,3),16)/255,
                parseInt(normalized.slice(3,5),16)/255,
                parseInt(normalized.slice(5,7),16)/255
            ];
        }
        const match=normalized.match(/^rgba?\((\d+), ?(\d+), ?(\d+)/i);
        if(match)return [Number(match[1])/255,Number(match[2])/255,Number(match[3])/255];
    }catch(error){}
    return defaultColor.slice();
}

function fabricObjectNativeKind(object){
    if(isTextObject(object))return 'freeText';
    if(isArrowGroup(object))return object.annotationType==='doubleArrow'?'doubleArrow':'arrow';
    if(isFabricType(object,'line'))return 'line';
    if(isFabricType(object,'rect'))return object.annotationType==='highlightBox'?'highlightBox':'square';
    if(isFabricType(object,'ellipse'))return object.annotationType==='highlightEllipse'?'highlightEllipse':'circle';
    if(isFabricType(object,'path')){
        if(object.annotationType==='cloud')return 'cloud';
        if(object.annotationType==='highlightPen')return 'highlightPen';
        return 'ink';
    }
    return 'stamp';
}

function getNativeStrokeSource(object,kind){
    if(kind==='arrow'||kind==='doubleArrow')return (object._objects||[]).find(part=>isFabricType(part,'line'))||object;
    return object;
}

function transformFabricPoint(object,x,y){
    const matrix=object.calcTransformMatrix();
    return fabric.util.transformPoint(new fabric.Point(x,y),matrix);
}

function getNativeLinePoints(object,kind,mapPoint){
    if(kind!=='line'&&kind!=='arrow'&&kind!=='doubleArrow')return [];
    const line=getNativeStrokeSource(object,kind);
    if(!line||typeof line.calcLinePoints!=='function')return [];
    const points=line.calcLinePoints();
    const start=mapPoint(transformFabricPoint(line,points.x1,points.y1));
    const end=mapPoint(transformFabricPoint(line,points.x2,points.y2));
    return [start.x,start.y,end.x,end.y];
}

function sampleNativeInkPath(object,mapPoint){
    if(!Array.isArray(object.path)||!object.path.length)return [];
    const offset=object.pathOffset||{x:0,y:0};
    const points=[];
    let current={x:0,y:0};
    let start={x:0,y:0};
    const add=(x,y)=>{
        const display=transformFabricPoint(object,x-offset.x,y-offset.y);
        const pdfPoint=mapPoint(display);
        points.push(pdfPoint.x,pdfPoint.y);
    };
    object.path.forEach(command=>{
        const op=String(command[0]||'').toUpperCase();
        if(op==='M'){
            current={x:Number(command[1])||0,y:Number(command[2])||0};
            start={...current};
            add(current.x,current.y);
        }else if(op==='L'){
            current={x:Number(command[1])||0,y:Number(command[2])||0};
            add(current.x,current.y);
        }else if(op==='Q'){
            const from={...current};
            const control={x:Number(command[1])||0,y:Number(command[2])||0};
            const to={x:Number(command[3])||0,y:Number(command[4])||0};
            for(let step=1;step<=8;step++){
                const t=step/8,one=1-t;
                add((one*one*from.x)+(2*one*t*control.x)+(t*t*to.x),
                    (one*one*from.y)+(2*one*t*control.y)+(t*t*to.y));
            }
            current=to;
        }else if(op==='C'){
            const from={...current};
            const c1={x:Number(command[1])||0,y:Number(command[2])||0};
            const c2={x:Number(command[3])||0,y:Number(command[4])||0};
            const to={x:Number(command[5])||0,y:Number(command[6])||0};
            for(let step=1;step<=12;step++){
                const t=step/12,one=1-t;
                add((one**3*from.x)+(3*one*one*t*c1.x)+(3*one*t*t*c2.x)+(t**3*to.x),
                    (one**3*from.y)+(3*one*one*t*c1.y)+(3*one*t*t*c2.y)+(t**3*to.y));
            }
            current=to;
        }else if(op==='Z'){
            current={...start};
            add(current.x,current.y);
        }
    });
    return points.length>=4?points:[];
}

function cropCanvasToObjectBounds(canvas,fabricCanvas,object,rotation,multiplier=1){
    if(!canvas||!object)return null;
    const rot=normalizeRotationAngle(rotation);
    const sourceWidth=(rot===90||rot===270)?canvas.height:canvas.width;
    const sourceHeight=(rot===90||rot===270)?canvas.width:canvas.height;
    const raw=object.getBoundingRect(true,true);
    const stroke=Math.max(1,Number(getNativeStrokeSource(object,fabricObjectNativeKind(object)).strokeWidth)||1);
    const padding=Math.max(6,stroke*multiplier*2);
    const unrotated={
        x:(raw.left*multiplier)-padding,
        y:(raw.top*multiplier)-padding,
        width:(raw.width*multiplier)+(padding*2),
        height:(raw.height*multiplier)+(padding*2)
    };
    const bounds=window.EditorUtils.rotatePixelRect(unrotated,sourceWidth,sourceHeight,rot);
    const minX=Math.max(0,Math.floor(bounds.x));
    const minY=Math.max(0,Math.floor(bounds.y));
    const maxX=Math.min(canvas.width,Math.ceil(bounds.x+bounds.width));
    const maxY=Math.min(canvas.height,Math.ceil(bounds.y+bounds.height));
    if(maxX<=minX||maxY<=minY)return null;
    const cropped=document.createElement('canvas');
    cropped.width=maxX-minX;
    cropped.height=maxY-minY;
    cropped.getContext('2d').drawImage(canvas,minX,minY,cropped.width,cropped.height,0,0,cropped.width,cropped.height);
    return {canvas:cropped,x:minX,y:minY,sourceWidth:canvas.width,sourceHeight:canvas.height};
}

function renderNativeObjectAppearance(canvas,object,rotation){
    const objects=canvas.getObjects();
    const visibility=objects.map(item=>item.visible!==false);
    const active=canvas.getActiveObject();
    canvas.discardActiveObject();
    objects.forEach(item=>{item.visible=item===object;});
    canvas.renderAll();
    try{
        const normalized=buildNormalizedOverlayCanvas(canvas,rotation,SAVE_OVERLAY_SCALE);
        return cropCanvasToObjectBounds(normalized,canvas,object,rotation,SAVE_OVERLAY_SCALE);
    }finally{
        objects.forEach((item,index)=>{item.visible=visibility[index];});
        if(active&&objects.includes(active))canvas.setActiveObject(active);
        canvas.renderAll();
    }
}

async function createNativeAnnotationDescriptors(baseDoc){
    const descriptors=[];
    const usedAnnotationIds=new Set();
    const containers=Array.from(document.querySelectorAll('.pdf-page-container'))
        .sort((a,b)=>parseInt(a.dataset.pageNum,10)-parseInt(b.dataset.pageNum,10));
    for(let containerIndex=0;containerIndex<containers.length;containerIndex++){
        const pageNumber=parseInt(containers[containerIndex].dataset.pageNum,10);
        const canvas=fabricCanvases.get(pageNumber);
        if(!canvas||!canvas.getObjects().length)continue;
        const page=baseDoc.getPage(pageNumber-1);
        const jsPage=await pdfDoc.getPage(pageNumber);
        const view=jsPage.view||[0,0,page.getWidth(),page.getHeight()];
        const box={x:view[0],y:view[1],w:view[2]-view[0],h:view[3]-view[1]};
        const rotation=normalizeRotationAngle(jsPage.rotate);
        const savedVpt=canvas.viewportTransform.slice();
        const savedWidth=canvas.getWidth(),savedHeight=canvas.getHeight();
        const currentVptRatio=baseScale/(canvas._renderFitScale||(baseScale/zoomFactor));
        canvas.setViewportTransform([1,0,0,1,0,0]);
        setFabricCanvasDimensions(canvas,savedWidth/currentVptRatio,savedHeight/currentVptRatio);
        try{
            const pixelWidth=canvas.getWidth(),pixelHeight=canvas.getHeight();
            const mapPoint=point=>mapDisplayPointToPdf(point,rotation,pixelWidth,pixelHeight,box.x,box.y,box.w,box.h);
            for(const object of canvas.getObjects()){
                if(!object||object.visible===false)continue;
                const appearance=renderNativeObjectAppearance(canvas,object,rotation);
                if(!appearance)continue;
                const rect=[
                    box.x+(appearance.x/appearance.sourceWidth)*box.w,
                    box.y+(1-((appearance.y+appearance.canvas.height)/appearance.sourceHeight))*box.h,
                    box.x+((appearance.x+appearance.canvas.width)/appearance.sourceWidth)*box.w,
                    box.y+(1-(appearance.y/appearance.sourceHeight))*box.h
                ];
                const kind=fabricObjectNativeKind(object);
                const strokeSource=getNativeStrokeSource(object,kind);
                const colorSource=isTextObject(object)?object.fill:(isHighlightLayerObject(object)?object._hlBaseColor:strokeSource.stroke||object.fill);
                const nativeColor=parseCssColor(colorSource);
                let fill=isPageTextReplacement(object)
                    ?parseCssColor(object.backgroundColor||'#ffffff',[1,1,1])
                    :isHighlightAreaObject(object)
                    ?parseCssColor(object._hlBaseColor||object.fill)
                    :((supportsFillObject(object)&&object.fill&&object.fill!=='transparent')?parseCssColor(object.fill):null);
                if(kind==='arrow'||kind==='doubleArrow')fill=nativeColor.slice();
                const rotatedAxes=rotation===90||rotation===270;
                const pointScale=((rotatedAxes?box.h:box.w)/pixelWidth+
                    (rotatedAxes?box.w:box.h)/pixelHeight)/2;
                const rawOpacity=Number(object.opacity);
                const descriptor={
                    id:ensureUniqueDraftAnnotationId(object,usedAnnotationIds),
                    pageIndex:pageNumber-1,
                    kind,
                    rect,
                    color:nativeColor,
                    fillColor:fill,
                    opacity:isHighlightLayerObject(object)?HIGHLIGHT_LAYER_ALPHA:
                        (Number.isFinite(rawOpacity)?Math.max(0,Math.min(1,rawOpacity)):1),
                    width:Math.max(0.1,(Number(strokeSource.strokeWidth)||1)*pointScale),
                    contents:isTextObject(object)?String(object.text||''):'',
                    fontSize:isTextObject(object)?Math.max(1,(Number(object.fontSize)||12)*pointScale):undefined,
                    alignment:isTextObject(object)?({left:0,center:1,right:2}[object.textAlign]||0):undefined,
                    appearancePngBytes:canvasToPngBytes(appearance.canvas)
                };
                const line=getNativeLinePoints(object,kind,mapPoint);
                if(line.length)descriptor.line=line;
                if(kind==='ink'||kind==='highlightPen'){
                    const ink=sampleNativeInkPath(object,mapPoint);
                    if(ink.length)descriptor.inkLists=[ink];
                }
                descriptors.push(descriptor);
            }
        }finally{
            setFabricCanvasDimensions(canvas,savedWidth,savedHeight);
            canvas.setViewportTransform(savedVpt);
            canvas.renderAll();
        }
    }
    return descriptors;
}

// ─── SAVE PROGRESS OVERLAY ──────────────────────────
const _saveEls={};
function _getSaveEl(id){return _saveEls[id]||(_saveEls[id]=document.getElementById(id));}
function updateSaveProgress(percent,step,pageInfo){
    const overlay=_getSaveEl('saveOverlay');
    const bar=_getSaveEl('saveBar');
    const pct=_getSaveEl('savePercent');
    const stepEl=_getSaveEl('saveStep');
    const pageEl=_getSaveEl('savePageInfo');
    const titleEl=_getSaveEl('saveTitle');
    const spinnerEl=_getSaveEl('saveSpinner');
    if(!overlay)return;
    overlay.classList.remove('hidden');
    if(bar)bar.style.width=percent+'%';
    if(pct)pct.textContent=Math.round(percent)+'%';
    if(stepEl)stepEl.textContent=step||'';
    if(pageEl)pageEl.textContent=pageInfo||'';
    if(percent>=100){
        if(titleEl)titleEl.textContent='Done!';
        if(spinnerEl){spinnerEl.style.animation='none';spinnerEl.style.borderColor='#059669';spinnerEl.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;margin:5px;"><polyline points="20 6 9 17 4 12"/></svg>';}
    }
}
function hideSaveOverlay(){
    const overlay=document.getElementById('saveOverlay');
    if(overlay)overlay.classList.add('hidden');
    // Reset spinner for next save
    const spinnerEl=document.getElementById('saveSpinner');
    const titleEl=document.getElementById('saveTitle');
    if(spinnerEl){spinnerEl.style.animation='spin 0.7s linear infinite';spinnerEl.style.borderColor='';spinnerEl.style.borderTopColor='';spinnerEl.innerHTML='';spinnerEl.style.cssText='width:36px;height:36px;border-radius:50%;border:3px solid #d1fae5;border-top-color:#059669;animation:spin 0.7s linear infinite;flex-shrink:0;';}
    if(titleEl)titleEl.textContent='Saving PDF...';
}
// Allow UI to repaint between heavy sync steps
function yieldToUI(){return new Promise(r=>setTimeout(r,0));}

async function saveAllPagesAsPDF(){
    if(!numPages||!fabricCanvases.size){showMsg("Load PDF first");return;}
    if(!originalPdfBytes){showMsg("Missing source PDF");return;}
    btnSavePdf.disabled=true;btnSavePdf.textContent='Saving...';
    updateSaveProgress(0,'Preparing annotations...');
    await yieldToUI();
    try{
        // Commit in-progress text edits before serializing native annotations.
        fabricCanvases.forEach(c=>{
            const a=c.getActiveObject();
            if(a&&a.isEditing&&a.exitEditing){a.exitEditing();c.discardActiveObject();c.renderAll();}
        });
        syncPendingTextEdits();

        updateSaveProgress(3,'Preparing all annotated pages...');
        await materializePendingAnnotations();

        updateSaveProgress(5,'Loading PDF document...');
        await yieldToUI();
        const {PDFDocument}=window.PDFLib;
        let baseDoc;
        try{baseDoc=await PDFDocument.load(originalPdfBytes);}
        catch(e){baseDoc=await PDFDocument.load(originalPdfBytes,{ignoreEncryption:true});}

        updateSaveProgress(12,'Building native PDF annotations...');
        await yieldToUI();
        const nativeDescriptors=await createNativeAnnotationDescriptors(baseDoc);
        const editableAnnotationPackage=await createAnnotationPackage(nativeDescriptors);

        updateSaveProgress(72,'Writing standard PDF annotations...');
        await yieldToUI();
        await window.NativeAnnotationUtils.replaceDraftNativeAnnotations(
            baseDoc,window.PDFLib,nativeDescriptors);

        updateSaveProgress(84,'Embedding DraftAnnotator edit metadata...');
        await yieldToUI();
        window.NativeAnnotationUtils.removeEmbeddedFilesByName(baseDoc,window.PDFLib,[
            window.EmbeddedAnnotationUtils.NATIVE_ANNOTATIONS_NAME,
            window.EmbeddedAnnotationUtils.ANNOTATIONS_NAME,
            window.EmbeddedAnnotationUtils.SOURCE_PDF_NAME
        ]);
        await window.EmbeddedAnnotationUtils.embedNativeStateIntoPdf(baseDoc,editableAnnotationPackage);

        updateSaveProgress(88,'Compiling final PDF...');
        await yieldToUI();
        const pdfBytes=await baseDoc.save({useObjectStreams:true});

        const blob=new Blob([pdfBytes],{type:'application/pdf'});
        const sourceName=currentFileName||'annotated_document';
        const saveName=/\.pdf$/i.test(sourceName)?sourceName.replace(/\.pdf$/i,'_annotated.pdf'):`${sourceName}_annotated.pdf`;
        if(isDraftReviewMode()){
            updateSaveProgress(94,'Syncing editable annotations...');
            await waitForDraftAutosaves();
            updateSaveProgress(96,'Uploading draft preview...');
            await yieldToUI();
            await uploadDraftRenderedPdf(pdfBytes,saveName);
        }else{
            updateSaveProgress(96,'Preparing download...');
            await yieldToUI();
            const link=document.createElement('a');
            link.href=URL.createObjectURL(blob);link.download=saveName;link.click();
            setTimeout(()=>URL.revokeObjectURL(link.href),60000);
        }
        fabricCanvases.forEach((c,pn)=>{
            const state=getSerializedCanvasState(c);
            c._lastSavedState=state;
            savedStateByPage.set(pn,state);
        });
        hasPendingTextEdits=false;
        recomputeUnsavedChanges();
        syncSizeControl();

        updateSaveProgress(100,nativeDescriptors.length>0
            ?(isDraftReviewMode()?'Draft saved with editable PDF annotations!':'PDF saved with editable annotations!')
            :'Saved (no annotations found)','');
        await yieldToUI();
        setTimeout(hideSaveOverlay,1200);
    }catch(err){
        console.error('Save err:',err);
        hideSaveOverlay();
        showMsg(`Error: ${err.message}`);
    }
    finally{btnSavePdf.disabled=false;btnSavePdf.textContent=isDraftReviewMode()?'Save Draft':'Save PDF';}
}

function showMsg(m){
    const b=document.getElementById('tempMessageBox');if(!b)return;
    b.textContent=m;b.style.opacity='1';
    if(b._timer)clearTimeout(b._timer);
    b._timer=setTimeout(()=>b.style.opacity='0',2000);
}

let scrollTicking=false;
let pristinePageReleaseTimer=null;

function releaseDistantPristinePages(){
    for(const [pageNum,canvas] of Array.from(fabricCanvases.entries())){
        // Never park a page that has been edited, participates in history, is
        // selected, or is close enough that the user may interact with it.
        if(canvas._historySeeded||canvas.getObjects().length||canvas.getActiveObject())continue;
        const container=document.querySelector(`[data-page-num="${pageNum}"]`);
        if(!container||isContainerNearViewport(container,PDF_REFRESH_MARGIN_PX*1.5))continue;

        fabricCanvases.delete(pageNum);
        renderedPages.delete(pageNum);
        cancelPageRenderTask(pageNum);
        delete container.dataset.pdfZoom;
        container.dataset.rendered='false';
        const placeholder=document.createElement('div');
        placeholder.className='text-sm text-gray-400 py-6 text-center';
        placeholder.textContent='Loading page...';
        container.replaceChildren(placeholder);
        attachSearchTextProxy(pageNum,searchTextByPage.get(pageNum));
        Promise.resolve(canvas.dispose()).catch(error=>console.debug('Canvas park failed',error));
    }
}

function schedulePristinePageRelease(){
    clearTimeout(pristinePageReleaseTimer);
    pristinePageReleaseTimer=setTimeout(()=>{
        pristinePageReleaseTimer=null;
        releaseDistantPristinePages();
    },120);
}

window.addEventListener('scroll',()=>{
    if(scrollTicking)return;scrollTicking=true;
    requestAnimationFrame(()=>{
        updateVisiblePage();
        scrollTicking=false;
    });
},{passive:true});

// ─── KEYBOARD SHORTCUTS ─────────────────────────────
function isShortcutSettingsOpen(){
    return !!shortcutSettingsModal&&!shortcutSettingsModal.classList.contains('hidden');
}

function setShortcutSettingsStatus(message='',type='info'){
    if(!shortcutSettingsStatus)return;
    shortcutSettingsStatus.textContent=message;
    shortcutSettingsStatus.className=`shortcut-status ${type}`;
    shortcutSettingsStatus.classList.toggle('hidden',!message);
}

function setDraftShortcutBinding(scope,id,index,binding){
    if(!shortcutDraftConfig)return;
    const store=scope==='tools'?shortcutDraftConfig.tools:shortcutDraftConfig.actions;
    if(!store[id])store[id]=new Array(getShortcutFieldDefinition(scope,id).defaults.length).fill('');
    store[id][index]=binding;
}

function renderShortcutRows(scope,container){
    if(!container||!shortcutDraftConfig)return;
    container.innerHTML=getShortcutFieldDefinitions(scope).map(def=>{
        const bindings=getShortcutBindings(scope,def.id,shortcutDraftConfig);
        const buttons=def.defaults.map((_,index)=>{
            const binding=bindings[index]||'';
            const classes=['shortcut-slot-btn'];
            if(!binding)classes.push('shortcut-empty');
            if(activeShortcutCapture&&activeShortcutCapture.scope===scope&&activeShortcutCapture.id===def.id&&activeShortcutCapture.index===index){
                classes.push('capture-active');
            }
            const label=activeShortcutCapture&&activeShortcutCapture.scope===scope&&activeShortcutCapture.id===def.id&&activeShortcutCapture.index===index
                ? 'Press keys...'
                : (binding?formatShortcutBinding(binding):'Unassigned');
            return `<button type="button" class="${classes.join(' ')}" data-shortcut-scope="${scope}" data-shortcut-id="${def.id}" data-shortcut-index="${index}">${escapeHtml(label)}</button>`;
        }).join('');
        return `<div class="shortcut-row">
            <div class="shortcut-row-main">
                <div class="shortcut-row-title">${escapeHtml(def.label)}</div>
                <div class="shortcut-row-help">${escapeHtml(def.description)}</div>
            </div>
            <div class="shortcut-slot-group">${buttons}</div>
        </div>`;
    }).join('');
}

function renderShortcutSettings(){
    renderShortcutRows('tools',shortcutToolRows);
    renderShortcutRows('actions',shortcutActionRows);
}

function renderEditorSettingsDraft(){
    if(!editorSettingsDraft)return;
    if(settingsMaxStrokeSize)settingsMaxStrokeSize.value=String(editorSettingsDraft.maxStrokeSize);
    if(settingsMaxTextSize)settingsMaxTextSize.value=String(editorSettingsDraft.maxTextSize);
}

function openShortcutSettings(){
    shortcutDraftConfig=getCurrentShortcutConfig();
    editorSettingsDraft=getCurrentEditorSettings();
    activeShortcutCapture=null;
    renderShortcutSettings();
    renderEditorSettingsDraft();
    setShortcutSettingsStatus('Click a binding to remap it. Import merges known settings, ignores unknown ones, and saves immediately.','info');
    if(shortcutSettingsModal)shortcutSettingsModal.classList.remove('hidden');
    document.body.style.overflow='hidden';
}

function closeShortcutSettings(){
    activeShortcutCapture=null;
    shortcutDraftConfig=null;
    editorSettingsDraft=null;
    if(shortcutSettingsModal)shortcutSettingsModal.classList.add('hidden');
    setShortcutSettingsStatus('');
    document.body.style.overflow='';
}

function beginShortcutCapture(scope,id,index){
    activeShortcutCapture={scope,id,index};
    renderShortcutSettings();
    setShortcutSettingsStatus('Press the new shortcut now. Escape cancels capture.','info');
}

function handleShortcutSettingsClick(target){
    const trigger=target.closest('[data-shortcut-scope]');
    if(!trigger)return false;
    beginShortcutCapture(trigger.dataset.shortcutScope,trigger.dataset.shortcutId,parseInt(trigger.dataset.shortcutIndex,10));
    return true;
}

function saveShortcutSettings(){
    if(!shortcutDraftConfig||!editorSettingsDraft)return;
    const validation=validateShortcutConfig(shortcutDraftConfig);
    if(!validation.valid){
        setShortcutSettingsStatus('Shortcut mappings are invalid. Reset to default or fix the conflicting binding.','error');
        return;
    }
    const editorValidation=validateEditorSettings(editorSettingsDraft);
    if(!editorValidation.valid){
        setShortcutSettingsStatus('Editor settings are invalid. Check the max weight and max text size values.','error');
        return;
    }
    applyEditorSettings(editorValidation.normalized,{persist:true});
    applyShortcutConfig(shortcutDraftConfig,{persist:true});
    closeShortcutSettings();
    showMsg('Settings saved');
}

function resetShortcutDraftToDefault(){
    shortcutDraftConfig=createDefaultShortcutConfig();
    editorSettingsDraft=createDefaultEditorSettings();
    activeShortcutCapture=null;
    renderShortcutSettings();
    renderEditorSettingsDraft();
    setShortcutSettingsStatus('Default settings loaded. Save to apply them.','info');
}

function handleShortcutSettingsKeydown(e){
    if(!isShortcutSettingsOpen())return false;
    if(activeShortcutCapture){
        e.preventDefault();
        e.stopPropagation();
        if(e.key==='Escape'){
            activeShortcutCapture=null;
            renderShortcutSettings();
            setShortcutSettingsStatus('Shortcut capture cancelled.','info');
            return true;
        }
        if(e.key==='Backspace'||e.key==='Delete'){
            setDraftShortcutBinding(activeShortcutCapture.scope,activeShortcutCapture.id,activeShortcutCapture.index,'');
            activeShortcutCapture=null;
            renderShortcutSettings();
            setShortcutSettingsStatus('Shortcut cleared. Save settings to keep the change.','info');
            return true;
        }
        const binding=serializeShortcutFromEvent(e);
        if(!binding){
            setShortcutSettingsStatus('Press a non-modifier key or key combination.','error');
            return true;
        }
        const conflict=findShortcutConflict(shortcutDraftConfig,binding,activeShortcutCapture);
        if(conflict){
            setShortcutSettingsStatus(`${formatShortcutBinding(binding)} is already assigned to ${getShortcutFieldLabel(conflict.scope,conflict.id)}.`,'error');
            return true;
        }
        setDraftShortcutBinding(activeShortcutCapture.scope,activeShortcutCapture.id,activeShortcutCapture.index,binding);
        activeShortcutCapture=null;
        renderShortcutSettings();
        setShortcutSettingsStatus(`Assigned ${formatShortcutBinding(binding)}. Save settings to apply it.`,'success');
        return true;
    }
    if(e.key==='Escape'){
        e.preventDefault();
        closeShortcutSettings();
        return true;
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){
        e.preventDefault();
        saveShortcutSettings();
        return true;
    }
    // Swallow app shortcuts while the modal is open, but let browser-level
    // keys (focus traversal, refresh, devtools) through.
    const isBrowserKey=e.key==='Tab'||e.key==='F5'||e.key==='F12'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='r');
    if(!isBrowserKey)e.preventDefault();
    return false;
}

function getShortcutActionForEvent(e){
    const binding=serializeShortcutFromEvent(e);
    return binding?shortcutLookup.actions.get(binding)||'':'';
}

function getShortcutToolForEvent(e){
    const binding=serializeShortcutFromEvent(e);
    return binding?shortcutLookup.tools.get(binding)||'':'';
}

function executeShortcutAction(actionId,{isTyping=false,isEditingCanvas=false,event=null}={}){
    switch(actionId){
        case 'copy': copySelectionToClipboard(); return true;
        case 'cut': cutSelectionToClipboard(); return true;
        case 'paste':
            if(objectClipboard&&objectClipboard.objects&&objectClipboard.objects.length){
                void pasteClipboardObjects().catch(error=>{
                    console.error('Paste failed:',error);
                    showMsg('Paste failed');
                });
            }
            else showMsg('Clipboard empty');
            return true;
        case 'selectAll': selectAllOnActivePage(); return true;
        case 'duplicate': duplicateActiveSelection(); return true;
        case 'save':
            if(!btnSavePdf.disabled)saveAllPagesAsPDF();
            return true;
        case 'undo': undo(); return true;
        case 'redo': redo(); return true;
        case 'deleteSelection': removeSelectionFromCanvas(getActiveSelectionContext()); return true;
        case 'deselect':
            if(isTyping&&event&&event.target&&typeof event.target.blur==='function'){event.target.blur();return true;}
            if(isEditingCanvas){
                fabricCanvases.forEach(c=>{
                    const ao=c.getActiveObject();
                    if(ao&&isTextObject(ao)&&ao.isEditing)ao.exitEditing();
                });
            }
            fabricCanvases.forEach(c=>{c.discardActiveObject();c.renderAll();});
            setActiveTool('select');
            return true;
        case 'zoomIn': zoomIn(); return true;
        case 'zoomOut': zoomOut(); return true;
        case 'zoomFit': zoomFit(); return true;
        // Nudges report whether anything was selected, so unhandled arrow
        // keys fall through to native page scrolling.
        case 'nudgeLeft': return nudgeActiveSelection(-1,0);
        case 'nudgeRight': return nudgeActiveSelection(1,0);
        case 'nudgeUp': return nudgeActiveSelection(0,-1);
        case 'nudgeDown': return nudgeActiveSelection(0,1);
        case 'nudgeLeftFast': return nudgeActiveSelection(-10,0);
        case 'nudgeRightFast': return nudgeActiveSelection(10,0);
        case 'nudgeUpFast': return nudgeActiveSelection(0,-10);
        case 'nudgeDownFast': return nudgeActiveSelection(0,10);
        default: return false;
    }
}

function isClipboardTextTarget(target){
    return !!target&&(target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.isContentEditable);
}

function isCanvasTextEditing(){
    for(const canvas of fabricCanvases.values()){
        const activeObject=canvas.getActiveObject();
        if(activeObject&&isTextObject(activeObject)&&activeObject.isEditing)return true;
    }
    return false;
}

function isNativeClipboardShortcutEvent(event,actionId){
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return false;
    const expectedCode={copy:'KeyC',cut:'KeyX',paste:'KeyV'}[actionId];
    return !!expectedCode&&event.code===expectedCode;
}

function writeInternalClipboardMarker(clipboardData){
    if(!clipboardData)return;
    try{clipboardData.setData(INTERNAL_CLIPBOARD_MIME,'1');}catch(error){}
    try{clipboardData.setData('text/plain',INTERNAL_CLIPBOARD_MARKER);}catch(error){}
}

function clipboardContainsInternalMarker(clipboardData){
    if(!clipboardData)return false;
    try{
        return clipboardData.getData(INTERNAL_CLIPBOARD_MIME)==='1'||
            clipboardData.getData('text/plain')===INTERNAL_CLIPBOARD_MARKER;
    }catch(error){return false;}
}

function getClipboardImageBlob(clipboardData){
    return window.EditorUtils.getClipboardImageBlob(clipboardData);
}

document.addEventListener('copy',event=>{
    if(isClipboardTextTarget(event.target)||isCanvasTextEditing()||(window.getSelection&&window.getSelection().toString()))return;
    if(!copySelectionToClipboard())return;
    event.preventDefault();
    writeInternalClipboardMarker(event.clipboardData);
});

document.addEventListener('cut',event=>{
    if(isClipboardTextTarget(event.target)||isCanvasTextEditing()||(window.getSelection&&window.getSelection().toString()))return;
    if(!cutSelectionToClipboard())return;
    event.preventDefault();
    writeInternalClipboardMarker(event.clipboardData);
});

document.addEventListener('paste',event=>{
    if(isClipboardTextTarget(event.target)||isCanvasTextEditing())return;
    const imageBlob=getClipboardImageBlob(event.clipboardData);
    if(imageBlob){
        event.preventDefault();
        void insertImageBlob(imageBlob,{source:'clipboard'});
        return;
    }
    if(!clipboardContainsInternalMarker(event.clipboardData))return;
    event.preventDefault();
    if(objectClipboard&&objectClipboard.objects&&objectClipboard.objects.length){
        void pasteClipboardObjects().catch(error=>{
            console.error('Paste failed:',error);
            showMsg('Paste failed');
        });
    }else{
        showMsg('Copied annotations are no longer available');
    }
});

document.addEventListener('keydown',e=>{
    if(isShortcutSettingsOpen()){
        handleShortcutSettingsKeydown(e);
        return;
    }

    const isTyping=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable;
    let isEditingCanvas=false;
    fabricCanvases.forEach(c=>{
        const ao=c.getActiveObject();
        if(ao&&isTextObject(ao)&&ao.isEditing)isEditingCanvas=true;
    });
    const matchedAction=getShortcutActionForEvent(e);
    const matchedTool=getShortcutToolForEvent(e);

    if(matchedAction==='save'||matchedAction==='deselect'){
        e.preventDefault();
        executeShortcutAction(matchedAction,{isTyping,isEditingCanvas,event:e});
        return;
    }

    if(isTyping||isEditingCanvas)return;

    if(matchedAction){
        // Let the browser emit native copy/cut/paste events. Those events expose
        // Windows screenshot image data and let us mark internal object copies.
        if(isNativeClipboardShortcutEvent(e,matchedAction))return;
        const handled=executeShortcutAction(matchedAction,{isTyping,isEditingCanvas,event:e});
        if(handled)e.preventDefault();
        return;
    }

    if(matchedTool){
        e.preventDefault();
        setActiveTool(matchedTool);
    }
});

// ─── DRAG & DROP ────────────────────────────────────
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{
    e.preventDefault();
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(!f)return;
    const isPdf=(((f.type||'').toLowerCase()==='application/pdf')||/\.pdf$/i.test(f.name||''));
    if(isPdf){
        recomputeUnsavedChanges();
        if(hasUnsavedChanges&&pdfDoc){if(!confirm('Unsaved changes will be lost. Continue?'))return;}
        loadPDF(f);
    }else{showMsg("Not a PDF");}
});

// ─── EVENT LISTENERS ────────────────────────────────
window.addEventListener('mouseup',stopPanning);
window.addEventListener('blur',stopPanning);

window.addEventListener('beforeunload',e=>{
    recomputeUnsavedChanges();
    if(hasUnsavedChanges){e.preventDefault();e.returnValue='Unsaved changes';return e.returnValue;}
});

btnLoadPdf.addEventListener('click',()=>{
    recomputeUnsavedChanges();
    if(hasUnsavedChanges&&pdfDoc){
        if(!confirm('Unsaved changes will be lost. Continue?'))return;
    }
    fileInput.click();
});

fileInput.addEventListener('change',e=>{
    const f=e.target.files[0];
    const isPdf=!!f&&(((f.type||'').toLowerCase()==='application/pdf')||/\.pdf$/i.test(f.name||''));
    if(isPdf)loadPDF(f);
    else if(f)showMsg("Not a PDF");
});

document.querySelectorAll('.tool-btn').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tool)setActiveTool(b.dataset.tool);}));
btnSavePdf.addEventListener('click',saveAllPagesAsPDF);
btnUndo.addEventListener('click',undo);
btnRedo.addEventListener('click',redo);
if(btnShortcutSettings)btnShortcutSettings.addEventListener('click',openShortcutSettings);
if(btnCloseShortcutSettings)btnCloseShortcutSettings.addEventListener('click',closeShortcutSettings);
if(btnCancelShortcutSettings)btnCancelShortcutSettings.addEventListener('click',closeShortcutSettings);
if(btnSaveShortcutSettings)btnSaveShortcutSettings.addEventListener('click',saveShortcutSettings);
if(btnImportSettings)btnImportSettings.addEventListener('click',()=>{if(settingsImportInput)settingsImportInput.click();});
if(btnExportSettingsJson)btnExportSettingsJson.addEventListener('click',exportSettingsAsJson);
if(btnExportSettingsCsv)btnExportSettingsCsv.addEventListener('click',exportSettingsAsCsv);
if(btnResetShortcutDefaults)btnResetShortcutDefaults.addEventListener('click',resetShortcutDraftToDefault);
if(settingsImportInput){
    settingsImportInput.addEventListener('change',async()=>{
        const file=settingsImportInput.files&&settingsImportInput.files[0];
        settingsImportInput.value='';
        if(!file)return;
        try{
            await importSettingsFromFile(file);
        }catch(e){
            const message=e&&e.message?e.message:'Settings import failed.';
            setShortcutSettingsStatus(message,'error');
            showMsg(message);
        }
    });
}
if(settingsMaxStrokeSize){
    settingsMaxStrokeSize.addEventListener('input',()=>{
        if(!editorSettingsDraft)return;
        editorSettingsDraft.maxStrokeSize=parseInt(settingsMaxStrokeSize.value,10)||0;
    });
}
if(settingsMaxTextSize){
    settingsMaxTextSize.addEventListener('input',()=>{
        if(!editorSettingsDraft)return;
        editorSettingsDraft.maxTextSize=parseInt(settingsMaxTextSize.value,10)||0;
    });
}
if(shortcutSettingsModal){
    shortcutSettingsModal.addEventListener('click',e=>{
        if(!e.target.closest('.shortcut-settings-panel'))closeShortcutSettings();
        else handleShortcutSettingsClick(e.target);
    });
}
if(btnPrevPage)btnPrevPage.addEventListener('click',()=>goToPage(currentVisiblePage-1));
if(btnNextPage)btnNextPage.addEventListener('click',()=>goToPage(currentVisiblePage+1));
if(pageJumpInput){
    pageJumpInput.addEventListener('change',()=>goToPage(pageJumpInput.value));
    pageJumpInput.addEventListener('keydown',e=>{
        if(e.key==='Enter'){
            e.preventDefault();
            goToPage(pageJumpInput.value);
        }
    });
}
if(arrowModeSelect){
    arrowModeSelect.addEventListener('change',()=>{
        if(applyArrowSelectValue(arrowModeSelect.value)){
            persistArrowModePreference();
            persistArrowNoteSidePreference();
            showMsg(`Arrow: ${arrowModeSelect.options[arrowModeSelect.selectedIndex].text}`);
        }
    });
}
if(highlightModeSelect){
    highlightModeSelect.addEventListener('change',()=>{
        const selected=highlightModeSelect.value;
        if(HIGHLIGHT_MODE_OPTIONS.includes(selected)){
            highlightMode=selected;
            persistHighlightModePreference();
            if(activeTool==='highlight')setActiveTool('highlight');
            showMsg(`Highlight mode: ${highlightModeSelect.options[highlightModeSelect.selectedIndex].text}`);
        }
    });
}
sizeSlider.addEventListener('input',()=>handleSizeChange(sizeSlider.value));
// Let people clear and replace the whole value without the editor clamping an
// intermediate empty/partial value. Validation happens on blur/change.
sizeNumber.addEventListener('change',commitSizeNumberInput);
sizeNumber.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
        event.preventDefault();
        commitSizeNumberInput();
        sizeNumber.blur();
    }
});
fontFamilySelect.addEventListener('change',()=>{
    currentFontFamily=fontFamilySelect.value;
    updateSelectedObjectProperties();
    persistToolbarPreference();
});
if(fillToggle)fillToggle.addEventListener('change',()=>handleFillToggleChange(fillToggle.checked));
if(fillOpacitySlider)fillOpacitySlider.addEventListener('input',()=>handleFillOpacityChange(fillOpacitySlider.value));
if(fillOpacityNumber)fillOpacityNumber.addEventListener('input',()=>handleFillOpacityChange(fillOpacityNumber.value));

// Color swatch clicks
document.querySelectorAll('.color-swatch').forEach(s=>s.addEventListener('click',()=>{setColor(s.dataset.color);addRecentColor(s.dataset.color);closeColorPopover();}));

function updatePopoverPreview(color){
    const normalized=normalizeToolbarColor(color)||currentColor;
    const previewDot=document.getElementById('colorPreviewDot');
    const hexInput=document.getElementById('hexInput');
    if(previewDot)previewDot.style.background=normalized;
    if(hexInput&&document.activeElement!==hexInput)hexInput.value=normalized.toUpperCase();
}

function bindPopoverSwatchHover(element,color){
    if(!element)return;
    const enter=()=>updatePopoverPreview(color);
    const leave=()=>updatePopoverPreview(currentColor);
    element.addEventListener('mouseenter',enter);
    element.addEventListener('focus',enter);
    element.addEventListener('mouseleave',leave);
    element.addEventListener('blur',leave);
}

function restoreToolAfterColorPopover(){
    if(!toolBeforeColorPopover)return;
    if(activeTool!==toolBeforeColorPopover)setActiveTool(toolBeforeColorPopover,{announce:false,persist:false});
    toolBeforeColorPopover=null;
}


// ─── RECENT COLORS ──────────────────────────────────
function getRecentColors(){
    try{const raw=localStorage.getItem(PREF_KEY_RECENT_COLORS);return raw?JSON.parse(raw):[];}
    catch(e){return [];}
}
function addRecentColor(color){
    const c=color.toLowerCase();
    let recent=getRecentColors();
    recent=recent.filter(r=>r!==c);
    recent.unshift(c);
    if(recent.length>12)recent.length=12;
    try{localStorage.setItem(PREF_KEY_RECENT_COLORS,JSON.stringify(recent));}catch(e){}
    renderRecentColors();
}
function renderRecentColors(){
    const container=document.getElementById('recentColors');
    const label=document.getElementById('recentColorsLabel');
    if(!container)return;
    const recent=getRecentColors();
    container.innerHTML='';
    if(recent.length===0){if(label)label.style.display='none';return;}
    if(label)label.style.display='block';
    recent.forEach(c=>{
        const s=document.createElement('div');
        s.className='mini-swatch';
        s.style.background=c;
        if(c==='#ffffff')s.style.border='2px solid #d1d5db';
        bindPopoverSwatchHover(s,c);
        s.addEventListener('click',()=>{setColor(c);addRecentColor(c);closeColorPopover();});
        container.appendChild(s);
    });
}

// ─── COLOR POPOVER ──────────────────────────────────
(function initColorPopover(){
    const rainbowBtn=document.getElementById('rainbowBtn');
    const popover=document.getElementById('colorPopover');
    const popoverWheel=document.getElementById('popoverWheel');
    const hexInput=document.getElementById('hexInput');

    const swatchContainer=document.getElementById('popoverSwatches');
    const eyedropperBtn=document.getElementById('eyedropperBtn');
    if(!rainbowBtn||!popover)return;

    // Hide eyedropper if browser doesn't support it
    if(!window.EyeDropper&&eyedropperBtn)eyedropperBtn.style.display='none';

    // Extended palette swatches
    const extraColors=[
        '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e',
        '#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7',
        '#d946ef','#ec4899','#f43f5e','#78716c','#64748b','#000000',
        '#ffffff','#991b1b','#9a3412','#854d0e','#166534','#1e3a5f',
        '#312e81','#581c87','#831843','#44403c'
    ];
    extraColors.forEach(c=>{
        const s=document.createElement('div');
        s.className='mini-swatch';
        s.style.background=c;
        if(c==='#ffffff')s.style.border='2px solid #d1d5db';
        bindPopoverSwatchHover(s,c);
        s.addEventListener('click',()=>{setColor(c);addRecentColor(c);closeColorPopover();});
        swatchContainer.appendChild(s);
    });

    // Render recent colors on init
    renderRecentColors();

    // Toggle popover — position it below the rainbow button
    rainbowBtn.addEventListener('click',(e)=>{
        e.stopPropagation();
        renderRecentColors();
        if(!popover.classList.contains('open')){
            toolBeforeColorPopover=activeTool;
            const rect=rainbowBtn.getBoundingClientRect();
            popover.style.top=(rect.bottom+8)+'px';
            // Align right edge with button right edge, clamp to viewport
            let left=rect.right-240;
            if(left<8)left=8;
            popover.style.left=left+'px';
            // Position the arrow to point at the button
            const arrowRight=rect.right-left-10;
            popover.style.setProperty('--arrow-right',Math.max(12,arrowRight)+'px');
            popover.classList.add('open');
        }else{
            closeColorPopover();
        }
    });

    // Eyedropper
    if(eyedropperBtn&&window.EyeDropper){
        eyedropperBtn.addEventListener('click',async()=>{
            try{
                const dropper=new EyeDropper();
                const result=await dropper.open();
                const c=result.sRGBHex;
                setColor(c);
                addRecentColor(c);
                closeColorPopover();
            }catch(e){/* user cancelled */}
        });
    }

    // Color wheel input
    popoverWheel.addEventListener('input',()=>{
        const c=popoverWheel.value;
        setColor(c);
    });
    popoverWheel.addEventListener('change',()=>{addRecentColor(popoverWheel.value);closeColorPopover();});

    // Hex input
    hexInput.addEventListener('keydown',(e)=>{
        if(e.key==='Enter'){
            e.preventDefault();
            applyHex({close:true});
        }
    });
    hexInput.addEventListener('blur',()=>applyHex());
    function applyHex({close=false}={}){
        let v=hexInput.value.trim();
        if(!v.startsWith('#'))v='#'+v;
        if(/^#[0-9a-fA-F]{6}$/.test(v)){
            setColor(v);addRecentColor(v);
        } else if(/^#[0-9a-fA-F]{3}$/.test(v)){
            v='#'+v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
            setColor(v);addRecentColor(v);
        }
        hexInput.value=currentColor.toUpperCase();
        if(close)closeColorPopover();
    }

    // Close on outside click
    document.addEventListener('click',(e)=>{
        if(!popover.contains(e.target)&&e.target!==rainbowBtn){
            closeColorPopover();
        }
    });
    // Prevent popover clicks from closing
    popover.addEventListener('click',(e)=>e.stopPropagation());
})();
function closeColorPopover(){
    const p=document.getElementById('colorPopover');
    if(p)p.classList.remove('open');
    updatePopoverPreview(currentColor);
    restoreToolAfterColorPopover();
}

// ─── IMAGE INSERT ───────────────────────────────────
(function initImageInsert(){
    const btnInsertImage=document.getElementById('btnInsertImage');
    const imageFileInput=document.getElementById('imageFileInput');
    if(!btnInsertImage||!imageFileInput)return;

    btnInsertImage.addEventListener('click',()=>{imageFileInput.click();});

    imageFileInput.addEventListener('change',async(e)=>{
        const file=e.target.files&&e.target.files[0];
        if(!file)return;
        imageFileInput.value='';
        await insertImageBlob(file,{source:'file'});
    });
})();

function readBlobAsDataUrl(blob){
    return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(reader.error||new Error('Failed to read image'));
        reader.readAsDataURL(blob);
    });
}

async function insertImageBlob(blob,{source='file'}={}){
    if(!blob||!/^image\//i.test(blob.type||'')){showMsg('Clipboard does not contain a supported image');return false;}
    if(blob.size>MAX_INSERT_IMAGE_BYTES){showMsg('Image is too large (20 MB maximum)');return false;}
    if(!getClipboardTargetCanvas()){showMsg('Open a PDF first');return false;}
    try{
        showMsg(source==='clipboard'?'Pasting screenshot...':'Preparing image...');
        const dataUrl=await readBlobAsDataUrl(blob);
        const optimized=await optimizeInsertedImage(dataUrl,blob.type);
        return await insertImageOnCanvas(optimized,{
            announceMessage:source==='clipboard'?'Screenshot pasted':'Image inserted'
        });
    }catch(error){
        console.error('Image preparation failed:',error);
        showMsg('Failed to prepare image');
        return false;
    }
}

function optimizeInsertedImage(dataUrl,mimeType=''){
    return new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=()=>{
            const maxDimension=2048;
            const width=image.naturalWidth||image.width;
            const height=image.naturalHeight||image.height;
            if(!width||!height){reject(new Error('Image has no dimensions'));return;}
            const scaleDown=Math.min(1,maxDimension/Math.max(width,height));
            if(scaleDown===1){resolve(dataUrl);return;}
            const canvas=document.createElement('canvas');
            canvas.width=Math.max(1,Math.round(width*scaleDown));
            canvas.height=Math.max(1,Math.round(height*scaleDown));
            const context=canvas.getContext('2d');
            if(!context){reject(new Error('Canvas unavailable'));return;}
            context.imageSmoothingEnabled=true;
            context.imageSmoothingQuality='high';
            context.drawImage(image,0,0,canvas.width,canvas.height);
            const outputType=/^image\/(jpeg|webp)$/i.test(mimeType)?mimeType.toLowerCase():'image/png';
            resolve(canvas.toDataURL(outputType,0.86));
        };
        image.onerror=()=>reject(new Error('Unsupported image'));
        image.src=dataUrl;
    });
}

async function loadFabricImage(dataUrl){
    const ImageClass=fabric.FabricImage||fabric.Image;
    if(FABRIC_MAJOR_VERSION>=6)return ImageClass.fromURL(dataUrl,{crossOrigin:'anonymous'});
    return new Promise(resolve=>ImageClass.fromURL(dataUrl,resolve,{crossOrigin:'anonymous'}));
}

async function insertImageOnCanvas(dataUrl,{targetCanvas=null,announceMessage='Image inserted'}={}){
    const canvas=targetCanvas||getClipboardTargetCanvas();
    if(!canvas){showMsg('Open a PDF first');return;}

    try{
        const img=await loadFabricImage(dataUrl);
        if(!img){showMsg('Failed to load image');return;}
        const vpt=canvas.viewportTransform||[1,0,0,1,0,0];
        const canvasW=canvas.width/vpt[0];
        const canvasH=canvas.height/vpt[3];
        const centerX=canvasW/2;
        const centerY=canvasH/2;
        const desiredX=lastCanvasMousePos&&lastCanvasMousePos.pageNum===canvas._pageNum?lastCanvasMousePos.x:centerX;
        const desiredY=lastCanvasMousePos&&lastCanvasMousePos.pageNum===canvas._pageNum?lastCanvasMousePos.y:centerY;
        const placement=window.EditorUtils.getContainedImagePlacement(
            img.width,img.height,canvasW,canvasH,desiredX,desiredY,0.8);

        img.set({
            left:placement.x,top:placement.y,
            originX:'center',originY:'center',
            scaleX:placement.scale,scaleY:placement.scale,
            selectable:true,evented:true,
            annotationType:'insertedImage'
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
        saveCanvasState(canvas);
        if(activeTool!=='select')setActiveTool('select',{announce:false});
        showMsg(announceMessage);
        return true;
    }catch(error){
        console.error('Image insertion failed:',error);
        showMsg('Failed to load image');
        return false;
    }
}

// ─── ZOOM CONTROLS ──────────────────────────────────
const zoomLevelEl=document.getElementById('zoomLevel');
const ZOOM_STEP=0.15;
const ZOOM_MIN=0.25;
const ZOOM_MAX=3.0;

function updateZoomDisplay(){
    if(zoomLevelEl)zoomLevelEl.textContent=Math.round(zoomFactor*100)+'%';
}

function clampZoom(newFactor){
    return Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,newFactor));
}

function getScrollContainer(){
    return document.scrollingElement||document.documentElement;
}

function captureViewportFocus(scrollEl){
    if(!scrollEl)return null;
    const focusY=scrollEl.scrollTop+scrollEl.clientHeight/2;
    const pageEl=document.querySelector(`[data-page-num="${currentVisiblePage}"]`);
    if(pageEl){
        const rect=pageEl.getBoundingClientRect();
        const pageTop=scrollEl.scrollTop+rect.top;
        const height=Math.max(1,rect.height);
        const percent=clampNumber((focusY-pageTop)/height,0,1);
        return {type:'page',pageNum:parseInt(pageEl.dataset.pageNum,10)||currentVisiblePage,percent};
    }
    const maxScroll=Math.max(1,scrollEl.scrollHeight-scrollEl.clientHeight);
    return {type:'ratio',ratio:scrollEl.scrollTop/maxScroll};
}

function restoreViewportFocus(scrollEl,focusState){
    if(!scrollEl||!focusState)return;
    const maxScroll=Math.max(0,scrollEl.scrollHeight-scrollEl.clientHeight);
    if(focusState.type==='page'&&focusState.pageNum){
        const pageEl=document.querySelector(`[data-page-num="${focusState.pageNum}"]`);
        if(pageEl){
            const rect=pageEl.getBoundingClientRect();
            const pageTop=scrollEl.scrollTop+rect.top;
            const height=Math.max(1,rect.height);
            const target=pageTop+focusState.percent*height-scrollEl.clientHeight/2;
            scrollEl.scrollTop=Math.max(0,Math.min(maxScroll,target));
            return;
        }
    }
    scrollEl.scrollTop=maxScroll>0?Math.max(0,Math.min(maxScroll,(focusState.ratio||0)*maxScroll)):0;
}

function getPendingZoomBase(){
    return queuedZoomFactor===null?zoomFactor:queuedZoomFactor;
}

async function applyZoom(newFactor){
    newFactor=clampZoom(newFactor);
    if(Math.abs(newFactor-zoomFactor)<0.001)return;
    const scrollEl=getScrollContainer();
    let scrollRatio=0;
    if(scrollEl){
        const maxScroll=Math.max(1,scrollEl.scrollHeight-scrollEl.clientHeight);
        scrollRatio=scrollEl.scrollTop/maxScroll;
    }
    const editingStates=captureEditingTextStates();
    try{
        zoomFactor=newFactor;
        updateZoomDisplay();
        if(!pdfDoc)return;

        const pg1=await pdfDoc.getPage(1);
        const vp1=pg1.getViewport({scale:1});
        const fitScale=getTargetPageWidth(vp1.width);
        baseScale=fitScale*zoomFactor;
        scale=baseScale;
        const fallbackViewport=pageViewportCache.get(1)||{width:vp1.width,height:vp1.height};

        for(const [n,fc] of fabricCanvases){
            const vp=pageViewportCache.get(n)||fallbackViewport;
            const dw=vp.width*scale,dh=vp.height*scale;

            const cont=document.querySelector(`[data-page-num="${n}"]`);
            if(cont){cont.style.width=`${dw}px`;cont.style.height=`${dh}px`;cont.style.minHeight=`${dh}px`;}

            const vptRatio=baseScale/(fc._renderFitScale||(baseScale/zoomFactor));
            setFabricCanvasDimensions(fc,dw,dh);
            fc.setViewportTransform([vptRatio,0,0,vptRatio,0,0]);
            refreshCanvasTextRendering(fc);
            fc.calcOffset();
            fc.requestRenderAll();

            if(cont&&isContainerNearViewport(cont)){
                try{
                    await ensurePagePdfLayerAtCurrentZoom(n,cont,true);
                }catch(err){
                    if(!isRenderCancelledError(err))console.error(`PDF rerender error page ${n}:`,err);
                }
            }else if(cont){
                const pdfC=cont.querySelector('.pdf-viewer-canvas');
                if(pdfC){
                    // Fast path for distant pages: resize display now, rerender PDF when page
                    // comes back near viewport (observer/goToPage).
                    pdfC.style.width=`${dw}px`;
                    pdfC.style.height=`${dh}px`;
                }
                scaleExistingPdfTextLayer(cont,dw,dh);
            }
        }

        for(let i=1;i<=numPages;i++){
            if(!fabricCanvases.has(i)){
                const cont=document.querySelector(`[data-page-num="${i}"]`);
                if(cont){
                    const vp=pageViewportCache.get(i)||fallbackViewport;
                    const dw=vp.width*scale,dh=vp.height*scale;
                    cont.style.width=`${dw}px`;cont.style.height=`${dh}px`;cont.style.minHeight=`${dh}px`;
                    scaleExistingPdfTextLayer(cont,dw,dh);
                }
            }
        }

        if(scrollEl){
            if(pendingResizeFocus){
                restoreViewportFocus(scrollEl,pendingResizeFocus);
                pendingResizeFocus=null;
            }else{
                const maxScroll=Math.max(1,scrollEl.scrollHeight-scrollEl.clientHeight);
                scrollEl.scrollTop=scrollRatio*maxScroll;
            }
        }
        updateVisiblePage();
        // Deferred offset recalc after DOM reflow settles
        requestAnimationFrame(()=>{fabricCanvases.forEach(fc=>fc.calcOffset());});
    }finally{
        restoreEditingTextStates(editingStates,{resumeEditing:false});
    }
}

let _zoomRetries=0;
async function queueZoom(newFactor){
    queuedZoomFactor=clampZoom(newFactor);
    if(zoomWorkerActive)return;
    zoomWorkerActive=true;
    try{
        while(queuedZoomFactor!==null){
            const next=queuedZoomFactor;
            queuedZoomFactor=null;
            await applyZoom(next);
            _zoomRetries=0;
        }
    }catch(err){
        if(!isRenderCancelledError(err))console.error('Zoom error:',err);
    }finally{
        zoomWorkerActive=false;
        if(queuedZoomFactor!==null&&_zoomRetries<3){_zoomRetries++;queueZoom(queuedZoomFactor);}
        else{_zoomRetries=0;queuedZoomFactor=null;}
    }
}

function zoomIn(){queueZoom(getPendingZoomBase()+ZOOM_STEP);}
function zoomOut(){queueZoom(getPendingZoomBase()-ZOOM_STEP);}
function zoomFit(){queueZoom(1.0);}

document.getElementById('btnZoomIn').addEventListener('click',zoomIn);
document.getElementById('btnZoomOut').addEventListener('click',zoomOut);
document.getElementById('btnZoomFit').addEventListener('click',zoomFit);

// Refit canvases on window resize so objects stay in place
let _resizeTimer=null;
window.addEventListener('resize',()=>{
    clearTimeout(_resizeTimer);
    _resizeTimer=setTimeout(()=>{
        const scrollEl=getScrollContainer();
        pendingResizeFocus=scrollEl?captureViewportFocus(scrollEl):null;
        if(pdfDoc&&baseScale!==null){
            // Force applyZoom to run even though zoomFactor hasn't changed
            // by temporarily nudging it, so baseScale recalculates from new window width
            const cur=zoomFactor;
            zoomFactor=-1;
            queueZoom(cur);
        }else{
            fabricCanvases.forEach(fc=>fc.calcOffset());
        }
    },150);
});

// Ctrl+scroll and Ctrl+/- zoom
document.addEventListener('wheel',(e)=>{
    if(e.ctrlKey||e.metaKey){
        e.preventDefault();
        const delta=e.deltaY>0?-ZOOM_STEP:ZOOM_STEP;
        queueZoom(getPendingZoomBase()+delta);
    }
},{passive:false});

// ─── INIT ───────────────────────────────────────────
loadArrowModePreference();
loadHighlightModePreference();
loadShortcutPreference();
loadEditorSettings();
loadToolbarPreference();
setColor(currentColor,{persist:false,applySelection:false});
setActiveTool(activeTool,{announce:false,persist:false});
updatePageNavControls();
updateZoomDisplay();
const pendingSettingsMessages=[pendingShortcutResetNotice,pendingEditorSettingsResetNotice,pendingToolbarStateResetNotice].filter(Boolean);
if(pendingSettingsMessages.length)showMsg(pendingSettingsMessages.join(' '));

if(!window.PDFLib||!window.NativeAnnotationUtils||!window.EmbeddedAnnotationUtils){
    console.error('PDF save libraries failed to load');
    showMsg('Save disabled: PDF annotation library missing');
    btnSavePdf.disabled=true;
}

// ─── LIBRARY LOAD CHECKS ────────────────────────────
(function checkLibraries(){
    const missing=[];
    if(!window.pdfjsLib) missing.push('pdf.js');
    if(!window.fabric) missing.push('fabric.js');
    if(!window.PDFLib) missing.push('pdf-lib');
    if(!window.EmbeddedAnnotationUtils) missing.push('embedded-annotation-utils.js');
    if(!window.NativeAnnotationUtils) missing.push('native-annotation-utils.js');
    if(!window.EditorUtils) missing.push('editor-utils.js');
    if(missing.length>0){
        const msg=document.getElementById('initialMessage');
        if(msg) msg.innerHTML=`<b style="color:#dc2626;">Failed to load: ${missing.join(', ')}</b><br>
            <span class="text-base">Check your internet connection and reload.<br>
            Once loaded, the app works offline.</span>`;
    }
})();

// ─── SERVICE WORKER REGISTRATION ────────────────────
const draftReviewConfig=(()=>{
    const params=new URLSearchParams(window.location.search);
    return {
        token:(params.get('draftToken')||'').trim(),
        apiUrl:(params.get('apiUrl')||'').trim().replace(/\/+$/,''),
        publicBaseUrl:(params.get('publicBaseUrl')||window.location.origin).trim().replace(/\/+$/,'')
    };
})();
let draftReviewContext=null;
const draftAutosaveTimers=new Map();
const draftAutosaveChains=new Map();
const draftAutosaveVersions=new Map();
const draftAutosaveFailedPages=new Set();
const pendingDraftPageAnnotations=new Map();
let draftReviewBootstrapping=false;

function isDraftReviewMode(){
    return Boolean(draftReviewConfig.token&&draftReviewConfig.apiUrl);
}

function ensureDraftSyncBadge(){
    let badge=document.getElementById('draftSyncBadge');
    if(badge)return badge;
    const actionsRow=btnSavePdf&&btnSavePdf.parentElement;
    if(!actionsRow)return null;
    badge=document.createElement('div');
    badge.id='draftSyncBadge';
    badge.style.cssText='font-size:12px;font-weight:600;padding:6px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;';
    actionsRow.insertBefore(badge,btnSavePdf);
    return badge;
}

function setDraftSyncStatus(message,tone='neutral'){
    const badge=ensureDraftSyncBadge();
    if(!badge)return;
    badge.textContent=message;
    if(tone==='saved'){
        badge.style.background='#ecfdf5';
        badge.style.color='#047857';
        badge.style.borderColor='#a7f3d0';
    }else if(tone==='pending'){
        badge.style.background='#eff6ff';
        badge.style.color='#1d4ed8';
        badge.style.borderColor='#bfdbfe';
    }else if(tone==='error'){
        badge.style.background='#fef2f2';
        badge.style.color='#b91c1c';
        badge.style.borderColor='#fecaca';
    }else{
        badge.style.background='#f3f4f6';
        badge.style.color='#374151';
        badge.style.borderColor='#d1d5db';
    }
}

async function draftReviewFetch(path,init={}){
    const headers=new Headers(init.headers||{});
    const response=await fetch(`${draftReviewConfig.apiUrl}${path}`,{
        ...init,
        credentials:'include',
        headers
    });
    if(response.status===401) throw new Error('Sign in to the workspace to access this draft.');
    return response;
}

function applyDraftAnnotationsToCanvas(canvas,pageNumber,fabricJson,onDone){
    return new Promise((resolve,reject)=>{
        canvas._restoring=true;
        try{
            loadFabricCanvasFromJson(canvas,fabricJson,()=>{
                canvas._restoring=false;
                refreshCanvasTextRendering(canvas);
                canvas.forEachObject(o=>{
                    if(isHighlightLayerObject(o))normalizeHighlightVisual(o);
                    applyObjectInteractivity(o);
                });
                canvas.renderAll();
                canvas._lastSavedState=fabricJson;
                canvas._historySeeded=false;
                savedStateByPage.set(pageNumber,fabricJson);
                if(onDone)onDone();
                resolve();
            },copySerializedAnnotationMetadata).catch(error=>{
                canvas._restoring=false;
                reject(error);
            });
        }catch(error){
            canvas._restoring=false;
            reject(error);
        }
    });
}

async function hydrateDraftAnnotations(items){
    if(!Array.isArray(items)||!items.length)return;
    const tasks=items.filter(item=>item&&item.fabricJson).map(async item=>{
        if(item.pageNumber<1||item.pageNumber>numPages)return;
        const canvas=fabricCanvases.get(item.pageNumber);
        if(!canvas){
            // Page not rendered yet (pages render lazily on scroll). Stash the
            // server copy so renderPage can apply it — dropping it here would
            // let a later edit on that page autosave an empty canvas over it.
            pendingDraftPageAnnotations.set(item.pageNumber,item.fabricJson);
            return;
        }
        await applyDraftAnnotationsToCanvas(canvas,item.pageNumber,item.fabricJson);
    });
    await Promise.all(tasks);
    recomputeUnsavedChanges();
}

async function uploadDraftRenderedPdf(pdfBytes,fileName){
    if(!draftReviewContext?.draft?.id) throw new Error('Draft context missing');
    const response=await draftReviewFetch(`/drafts/${encodeURIComponent(draftReviewContext.draft.id)}/rendered-pdf`,{
        method:'PUT',
        headers:{
            'Content-Type':'application/pdf',
            'x-file-name':fileName
        },
        body:pdfBytes
    });
    if(!response.ok){
        const body=await response.json().catch(()=>null);
        throw new Error(body?.error||'Failed to save draft preview');
    }
    setDraftSyncStatus('Draft preview saved','saved');
    showMsg('Draft preview saved');
}

function queueDraftAnnotationSave(canvas){
    if(!isDraftReviewMode()||draftReviewBootstrapping||!draftReviewContext?.draft?.id||!canvas||canvas._restoring)return;
    const pageNum=canvas._pageNum;
    if(!pageNum)return;
    const existing=draftAutosaveTimers.get(pageNum);
    if(existing)clearTimeout(existing);
    const version=(draftAutosaveVersions.get(pageNum)||0)+1;
    draftAutosaveVersions.set(pageNum,version);
    setDraftSyncStatus('Saving changes…','pending');
    const timer=setTimeout(()=>{
        draftAutosaveTimers.delete(pageNum);
        const fabricJson=getSerializedCanvasState(canvas);
        const saveCurrentVersion=async()=>{
          try{
            const response=await draftReviewFetch(`/drafts/${encodeURIComponent(draftReviewContext.draft.id)}/annotations/${pageNum}`,{
                method:'PUT',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({fabricJson})
            });
            if(!response.ok){
                const body=await response.json().catch(()=>null);
                throw new Error(body?.error||'Autosave failed');
                }
                if(draftAutosaveVersions.get(pageNum)===version&&!draftAutosaveTimers.has(pageNum)){
                    draftAutosaveFailedPages.delete(pageNum);
                }
            }catch(err){
                console.error('Draft autosave failed:',err);
                if(draftAutosaveVersions.get(pageNum)===version){
                    draftAutosaveFailedPages.add(pageNum);
                    setDraftSyncStatus('Autosave failed','error');
                }
          }
        };
        const previous=draftAutosaveChains.get(pageNum)||Promise.resolve();
        const chain=previous.catch(()=>{}).then(saveCurrentVersion);
        draftAutosaveChains.set(pageNum,chain);
        chain.finally(()=>{
            if(draftAutosaveChains.get(pageNum)===chain)draftAutosaveChains.delete(pageNum);
            if(!draftAutosaveTimers.size&&!draftAutosaveChains.size&&!draftAutosaveFailedPages.size){
                setDraftSyncStatus('All changes saved','saved');
            }
        });
    },600);
    draftAutosaveTimers.set(pageNum,timer);
}

async function waitForDraftAutosaves(){
    while(draftAutosaveTimers.size)await new Promise(resolve=>setTimeout(resolve,650));
    if(draftAutosaveChains.size)await Promise.all(Array.from(draftAutosaveChains.values()));
    if(draftAutosaveFailedPages.size){
        throw new Error(`Annotation autosave failed on page(s): ${Array.from(draftAutosaveFailedPages).sort((a,b)=>a-b).join(', ')}`);
    }
}

const baseSaveCanvasState=saveCanvasState;
saveCanvasState=function(canvas){
    baseSaveCanvasState(canvas);
    queueDraftAnnotationSave(canvas);
};

async function initializeDraftReviewMode(){
    if(!isDraftReviewMode())return;
    btnLoadPdf.style.display='none';
    btnSavePdf.textContent='Save Draft';
    btnSavePdf.title='Save the current draft preview to the server';
    setDraftSyncStatus('Loading draft…','pending');
    draftReviewBootstrapping=true;
    try{
        const metaResponse=await draftReviewFetch(`/d/${encodeURIComponent(draftReviewConfig.token)}`);
        if(!metaResponse.ok){
            const body=await metaResponse.json().catch(()=>null);
            throw new Error(body?.error||'This draft link is not available.');
        }
        draftReviewContext=await metaResponse.json();
        if(draftReviewContext?.document?.title){
            document.title=`${draftReviewContext.document.title} | Draft Review`;
            const fileNameEl=document.getElementById('fileName');
            if(fileNameEl)fileNameEl.textContent=draftReviewContext.document.title;
        }
        const pdfResponse=await draftReviewFetch(`/drafts/${encodeURIComponent(draftReviewContext.draft.id)}/download`);
        if(!pdfResponse.ok){
            const body=await pdfResponse.json().catch(()=>null);
            throw new Error(body?.error||'Failed to load draft PDF');
        }
        const blob=await pdfResponse.blob();
        const sourceName=draftReviewContext?.file?.fileName||`${draftReviewContext?.document?.title||'draft'}.pdf`;
        await loadPDF(new File([blob],sourceName,{type:'application/pdf'}));
        await hydrateDraftAnnotations(draftReviewContext.annotations||[]);
        setDraftSyncStatus('All changes saved','saved');
        showMsg('Draft loaded');
    }catch(err){
        console.error('Draft review init failed:',err);
        const message=err instanceof Error?err.message:'Failed to load draft';
        const msg=document.getElementById('initialMessage');
        if(msg){
            msg.style.display='block';
            msg.innerHTML=`<b style="color:#dc2626;">${escapeHtml(message)}</b><br><span class="text-base">Sign in to the workspace and reopen the review link.</span>`;
        }
        setDraftSyncStatus('Draft unavailable','error');
        showMsg(message);
    }finally{
        draftReviewBootstrapping=false;
    }
}

// This is a plain web page, not an installable PWA. Unregister any
// service worker that a previous version may have registered, and nuke the
// old caches so users get fresh HTML/JS directly from the server.
if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs=>{
        regs.forEach(r=>r.unregister().catch(()=>{}));
    }).catch(()=>{});
    if(window.caches&&caches.keys){
        caches.keys().then(keys=>{
            keys.forEach(k=>{ if(/draftannotator/i.test(k))caches.delete(k).catch(()=>{}); });
        }).catch(()=>{});
    }
}

// Belt-and-suspenders: some browsers still try to show an install banner if
// they've seen the site as a PWA before. Swallow the event silently.
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); });

// ─── BUILD INFO ────────────────────────────────────
{
    const bd=document.getElementById('buildDate');
    if(bd){
        // Auto-stamped by hooks/pre-commit on every commit. Do not edit by hand.
        const built='2026-09-09 16:56 PDT';
        bd.textContent='Built '+built;
    }
}

// ─── MOBILE SIDEBAR DRAWER ──────────────────────────
{
    const btn=document.getElementById('btnMobileMenu');
    const sidebar=document.getElementById('sidebar');
    const backdrop=document.getElementById('sidebarBackdrop');
    const openDrawer=()=>{sidebar.classList.add('open');backdrop.classList.add('open');};
    const closeDrawer=()=>{sidebar.classList.remove('open');backdrop.classList.remove('open');};
    if(btn)btn.addEventListener('click',()=>{
        if(sidebar.classList.contains('open'))closeDrawer();else openDrawer();
    });
    if(backdrop)backdrop.addEventListener('click',closeDrawer);
    document.addEventListener('keydown',e=>{
        if(e.key==='Escape'&&sidebar.classList.contains('open'))closeDrawer();
    });
    window.addEventListener('resize',()=>{
        if(window.innerWidth>768)closeDrawer();
    });
}

// ─── OFFLINE / ONLINE STATUS ────────────────────────
window.addEventListener('online',()=>showMsg('Back online'));
window.addEventListener('offline',()=>showMsg('Offline — app still works'));
initializeDraftReviewMode().catch(err=>console.error('Draft bootstrap failed:',err));
