const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const user = { id: 'user-a' };
const defaults = () => [
    {id:'study', name:'Study', color:'#b879e8', user_id:user.id, created_at:'2026-01-01'},
    {id:'personal', name:'Personal', color:'#f47f91', user_id:user.id, created_at:'2026-01-02'}
];
function database(rows = defaults()) {
    const db = { rows: structuredClone(rows), todoRows: [], calls: [], fail: null, hold: null, serial: 0, todoSerial: 0 };
    db.client = { from(table) {
        assert.ok(['categories','todos'].includes(table));
        let action = 'select', payload, columns, single = false;
        const filters = [], order = [];
        const query = {
            select(value) { columns=value; return query; },
            insert(value) { action='insert'; payload=value; return query; },
            update(value) { action='update'; payload=value; return query; },
            delete() { action='delete'; return query; },
            eq(key,value) { filters.push([key,value]); return query; },
            order(key,value) { order.push([key,value]); return query; },
            single() { single=true; return query; },
            async then(resolve,reject) {
                try {
                    db.calls.push({table,action,payload,filters,order,columns});
                    const fail = db.fail; db.fail=null;
                    const hold = db.hold; db.hold=null;
                    if (hold) await hold;
                    if (fail) return resolve({data:null,error:fail});
                    let target=table==='categories'?db.rows:db.todoRows;
                    let selected=target.filter(row=>filters.every(([key,value])=>row[key]===value));
                    if(action==='insert') {
                        const number=table==='categories'?++db.serial:++db.todoSerial;
                        const row={...payload,id:`${table==='categories'?'new':'todo'}-${number}`,created_at:`2026-02-${String(number).padStart(2,'0')}`};
                        target.push(row);selected=[row];
                    }
                    if(action==='update') for(const row of selected) Object.assign(row,payload);
                    if(action==='delete') {
                        const kept=target.filter(row=>!selected.includes(row));
                        if(table==='categories') db.rows=kept; else db.todoRows=kept;
                    }
                    if(action==='select') selected.sort((a,b)=>String(a.todo_date||a.created_at).localeCompare(String(b.todo_date||b.created_at))||String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
                    if(single && selected.length!==1) return resolve({data:null,error:{code:'PGRST116'}});
                    resolve({data:structuredClone(single?selected[0]:selected),error:null});
                } catch(error) { reject(error); }
            }
        };
        return query;
    }};
    return db;
}
function boot(saved = {}, db = database()) {
    class Element {
        constructor() {
            this.children=[];this.events={};this.attributes={};this.style={setProperty:(k,v)=>{this.style[k]=v;}};
            this.value='';this.hidden=false;this.textContent='';
            const classes=new Set();this.classList={add:c=>classes.add(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};
        }
        append(...nodes){this.children.push(...nodes);}
        appendChild(node){this.append(node);return node;}
        replaceChildren(...nodes){this.children=nodes;}
        setAttribute(k,v){this.attributes[k]=v;}
        getAttribute(k){return this.attributes[k];}
        addEventListener(type,fn){(this.events[type] ||= []).push(fn);}
        focus(){}
        getBoundingClientRect(){return {top:100,bottom:120,left:200,right:220,width:160,height:80};}
        showModal(){this.open=true;}
        close(){this.open=false;this.fire('close');}
        showPopover(){this.open=true;this.fire('toggle',{newState:'open'});}
        hidePopover(){this.open=false;this.fire('toggle',{newState:'closed'});}
        async fire(type,props={}){for(const fn of this.events[type]||[]) await fn({preventDefault(){},currentTarget:this,...props});}
    }
    const elements=new Map();const storage=new Map(Object.entries(saved));
    const context=vm.createContext({console,Date,innerWidth:1440,innerHeight:900,
        document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}
    });
    vm.runInContext(source,context);
    return {db,storage,el:id=>elements.get(id),run:code=>vm.runInContext(code,context),login:who=>context.calendarCategoryController.setSession(db.client,who===undefined?user:who)};
}
function date(app,day=15){app.run(`currentYear=2026;currentMonth=8;selectedDate=new Date(2026,8,${day});showSelectedDate();renderCalendar()`);}
async function select(app,id){const i=app.run(`categories.findIndex(c=>c.id===${JSON.stringify(id)})`);assert.ok(i>=0);await app.el('categoryList').children[i].children[0].fire('click');}
async function add(app,text,id='study'){if(id)await select(app,id);app.el('todoInput').value=text;await app.el('addTodoButton').fire('click');}
function texts(app){return app.el('todoList').children.map(row=>row.children[2]?.textContent);}
function day(app,n){return app.el('calendar').children.find(e=>e.textContent===n);}
async function create(app,name='Work'){app.run('openCategoryForm()');app.el('categoryName').value=name;await app.el('categoryForm').fire('submit');return app.run('categories.at(-1).id');}
async function openMove(app,index=0){await app.el('todoList').children[index].children[3].fire('click');await app.el('openMoveTodoButton').fire('click');}
async function moveDay(app,n){await app.el('moveCalendar').children.find(e=>e.textContent===n).fire('click');await app.el('confirmMoveTodoButton').fire('click');}

test('loads only authenticated categories by created_at and leaves every local category backup untouched',async()=>{
    const backup='[{"id":"local","name":"Old","color":"#ffffff"}]';
    const db=database([...defaults(),{id:'foreign',name:'Secret',color:'#123456',user_id:'user-b',created_at:'2025'}]);
    const app=boot({calendarCategories:backup,'calendarCategories.beforeCategories':'backup'},db);
    assert.equal(app.run('categories.length'),0);assert.equal(db.calls.length,0);
    await app.login();
    assert.equal(app.run('categories.length'),2);
    assert.deepEqual(db.calls[0].filters,[['user_id','user-a']]);
    assert.equal(db.calls[0].order[0][0],'created_at');
    assert.equal(app.storage.get('calendarCategories'),backup);
    assert.equal(app.storage.get('calendarCategories.beforeCategories'),'backup');
});
test('INSERT uses current user_id and generated DB id; refresh reloads from the DB',async()=>{
    const app=boot();await app.login();
    const id=await create(app);
    const call=app.db.calls.find(c=>c.action==='insert');
    assert.equal(call.payload.user_id,user.id);assert.equal(call.payload.name,'Work');assert.equal(call.payload.id,undefined);
    assert.equal(app.run('categories.at(-1).id'),id);
    assert.equal(app.storage.has('calendarCategories'),false);
    const reload=boot(Object.fromEntries(app.storage),app.db);await reload.login();
    assert.equal(reload.run('categories.at(-1).id'),id);
});
test('UPDATE persists name/color and DELETE only updates local todos after DB success',async()=>{
    const app=boot();await app.login();date(app);await add(app,'Keep me');
    app.run("openCategoryForm(categories[0]);selectedColor='#4ecdb5'");app.el('categoryName').value='Renamed';
    await app.el('categoryForm').fire('submit');
    assert.equal(app.db.rows[0].name,'Renamed');assert.equal(app.db.rows[0].color,'#4ecdb5');
    assert.equal(app.el('todoList').children[0].children[1].title,'Renamed');
    app.run('openCategoryForm(categories[0])');await app.el('confirmDeleteCategoryButton').fire('click');
    assert.equal(app.db.rows.some(c=>c.id==='study'),false);
    assert.equal(app.run("todos['2026-09-15'][0].categoryId"),null);
    assert.equal(app.run("todos['2026-09-15'][0].text"),'Keep me');
    for(const call of app.db.calls.filter(c=>['update','delete'].includes(c.action)))assert.deepEqual(call.filters,[['id','study'],['user_id','user-a']]);
});
test('failed CRUD keeps original UI/data and displays an actionable error, including FK rejection',async()=>{
    const app=boot();await app.login();date(app);await add(app,'Preserve');
    app.db.fail={code:'network'};await create(app,'Retry');assert.equal(app.run('categories.length'),2);assert.ok(app.el('categoryError').textContent);
    await app.el('categoryForm').fire('submit');assert.equal(app.run('categories.length'),3);
    app.run('openCategoryForm(categories[0])');app.el('categoryName').value='Should not persist';app.db.fail={code:'42501'};
    await app.el('categoryForm').fire('submit');assert.equal(app.run('categories[0].name'),'Study');
    const original=app.storage.get('calendarTodos');app.db.fail={code:'23503'};
    await app.el('confirmDeleteCategoryButton').fire('click');assert.equal(app.storage.get('calendarTodos'),original);assert.equal(app.run('categories.length'),3);
    assert.match(app.el('categoryError').textContent,/삭제/);
});
test('loading and load failure block category writes, show status and allow retry',async()=>{
    const app=boot();let release;app.db.hold=new Promise(resolve=>release=resolve);
    const loading=app.login();assert.equal(app.el('manageCategoriesButton').disabled,true);assert.match(app.el('categoryStatus').textContent,/불러오는/);
    release();await loading;assert.equal(app.el('manageCategoriesButton').disabled,false);
    await app.login(null);app.db.fail={code:'network'};await app.login();
    assert.equal(app.el('retryCategoriesButton').hidden,false);assert.equal(app.el('manageCategoriesButton').disabled,true);
    await app.el('retryCategoriesButton').fire('click');assert.equal(app.el('manageCategoriesButton').disabled,false);
});
test('logout clears rendered data, blocks every write and preserves local backups and todos',async()=>{
    const app=boot({calendarCategories:'unchanged'});await app.login();date(app);await add(app,'Private');
    app.run('openCategoryForm(categories[0])');const original=app.storage.get('calendarTodos');await app.login(null);
    assert.equal(app.el('categoryList').children.length,0);assert.equal(app.el('categoryManagementList').children.length,0);
    assert.equal(app.el('categoryName').value,'');assert.equal(app.el('todoInput').disabled,true);
    assert.match(app.el('todoList').children[0].textContent,/로그인/);assert.equal(day(app,15).classList.contains('has-todos'),false);
    const count=app.db.calls.length;app.el('todoInput').value='Blocked';await app.el('addTodoButton').fire('click');await app.el('categoryForm').fire('submit');await app.el('confirmDeleteCategoryButton').fire('click');await app.el('confirmDeleteAllTodosButton').fire('click');
    assert.equal(app.db.calls.length,count);assert.equal(app.storage.get('calendarTodos'),original);assert.equal(app.storage.get('calendarCategories'),'unchanged');
    await app.login();assert.deepEqual(texts(app),['Private']);
});
test('late load and mutation responses cannot populate a signed-out or different account',async()=>{
    const app=boot();let release;app.db.hold=new Promise(resolve=>release=resolve);
    const loading=app.login();await app.login(null);release();await loading;assert.equal(app.run('categories.length'),0);
    await app.login();app.run('openCategoryForm()');app.el('categoryName').value='Late';
    app.db.hold=new Promise(resolve=>release=resolve);const pending=app.el('categoryForm').fire('submit');
    await new Promise(resolve=>setImmediate(resolve));await app.login({id:'user-b'});release();await pending;
    assert.equal(app.run('categories.length'),0);assert.equal(app.run('categoryUserId'),'user-b');
});
test('duplicate mutation and auth refresh do not duplicate rows or reload categories',async()=>{
    const app=boot();await app.login();const calls=app.db.calls.length;await app.login();assert.equal(app.db.calls.length,calls);
    let release;app.db.hold=new Promise(resolve=>release=resolve);app.run('openCategoryForm()');app.el('categoryName').value='Once';
    const pending=app.el('categoryForm').fire('submit');await app.el('categoryForm').fire('submit');release();await pending;
    assert.equal(app.db.rows.filter(c=>c.name==='Once').length,1);
});
test('Todo CRUD uses Supabase rows while the localStorage backup remains untouched',async()=>{
    const app=boot({calendarTodos:'legacy-backup'});await app.login();date(app);await add(app,'Personal','personal');await add(app,'Study','study');await add(app,'Second study','study');
    assert.deepEqual(texts(app),['Study','Second study','Personal']);await select(app,'personal');assert.equal(app.el('todoList').children.length,3);
    await app.el('todoList').children[0].children[0].fire('click');assert.equal(app.run("todos['2026-09-15'][1].completed"),true);
    assert.equal(app.storage.get('calendarTodos'),'legacy-backup');
    assert.equal(app.db.todoRows.length,3);assert.equal(app.db.todoRows.every(row=>row.user_id===user.id&&row.todo_date==='2026-09-15'),true);
    const reload=boot(Object.fromEntries(app.storage),app.db);await reload.login();date(reload);
    assert.deepEqual(texts(reload),['Study','Second study','Personal']);assert.equal(reload.storage.get('calendarTodos'),'legacy-backup');
    await reload.el('todoList').children[1].children[3].fire('click');await reload.el('deleteMenuTodoButton').fire('click');assert.deepEqual(texts(reload),['Study','Personal']);assert.equal(app.db.todoRows.length,2);
});
test('category sorting, representative date color and completion update after edits',async()=>{
    const app=boot();await app.login();date(app);await add(app,'One');await add(app,'Two','personal');
    assert.equal(day(app,15).style['--indicator-color'],'#b879e8');
    for(const row of [...app.el('todoList').children])await row.children[0].fire('click');assert.equal(day(app,15).classList.contains('all-completed'),true);
    app.run("openCategoryForm(categories[0]);selectedColor='#4ecdb5'");await app.el('categoryForm').fire('submit');assert.equal(day(app,15).style['--indicator-color'],'#4ecdb5');
});
test('date movement updates todo_date while retaining the DB row identity and properties',async()=>{
    const app=boot();await app.login();app.run('currentYear=2026;currentMonth=11;selectedDate=new Date(2026,11,31);showSelectedDate();renderCalendar()');
    await add(app,'Move');await app.el('todoList').children[0].children[0].fire('click');
    app.run("globalThis.original=todos['2026-12-31'][0];globalThis.originalId=original.id;globalThis.originalCreated=original.created_at");
    await openMove(app);await app.el('moveNextMonth').fire('click');assert.equal(app.el('moveMonthTitle').textContent,'2027년 1월');await moveDay(app,1);
    assert.equal(app.run("todos['2027-01-01'][0]===original"),true);assert.equal(app.run("todos['2026-12-31']"),undefined);
    assert.equal(app.run("todos['2027-01-01'][0].id===originalId"),true);assert.equal(app.run("todos['2027-01-01'][0].created_at===originalCreated"),true);
    assert.equal(app.run("todos['2027-01-01'][0].completed"),true);assert.equal(app.db.todoRows[0].todo_date,'2027-01-01');
    const reload=boot(Object.fromEntries(app.storage),app.db);await reload.login();assert.equal(reload.run("todos['2027-01-01'][0].id"),app.db.todoRows[0].id);
});
test('bulk deletion cancel/confirm preserves other dates and categories',async()=>{
    const app=boot();await app.login();date(app);await add(app,'Keep');date(app,16);await add(app,'Delete');
    await app.el('deleteAllTodosButton').fire('click');await app.el('cancelDeleteAllTodosButton').fire('click');await app.el('confirmDeleteAllTodosButton').fire('click');assert.equal(app.run("todos['2026-09-16'].length"),1);
    await app.el('deleteAllTodosButton').fire('click');await app.el('confirmDeleteAllTodosButton').fire('click');assert.equal(app.run("todos['2026-09-16']"),undefined);assert.equal(app.run("todos['2026-09-15'].length"),1);assert.equal(app.db.todoRows.length,1);assert.equal(app.db.todoRows[0].todo_date,'2026-09-15');
});
test('Todo load filters by user, and failed mutations never claim success in memory',async()=>{
    const db=database();
    db.todoRows.push(
        {id:'mine',todo_date:'2026-09-15',text:'Mine',completed:false,category_id:'study',user_id:'user-a',created_at:'2026-01-01'},
        {id:'foreign',todo_date:'2026-09-15',text:'Secret',completed:false,category_id:null,user_id:'user-b',created_at:'2026-01-01'}
    );
    const app=boot({calendarTodos:'do-not-touch'},db);await app.login();date(app);
    assert.deepEqual(texts(app),['Mine']);
    const load=db.calls.find(call=>call.table==='todos'&&call.action==='select');assert.deepEqual(load.filters,[['user_id','user-a']]);
    db.fail={code:'network'};app.el('todoInput').value='Fail insert';await app.el('addTodoButton').fire('click');assert.equal(app.run("todos['2026-09-15'].length"),1);assert.equal(app.el('todoInput').value,'Fail insert');
    db.fail={code:'network'};await app.el('todoList').children[0].children[0].fire('click');assert.equal(app.run("todos['2026-09-15'][0].completed"),false);
    assert.equal(app.storage.get('calendarTodos'),'do-not-touch');assert.ok(app.el('storageStatus').textContent);
});
test('empty remote categories allow uncategorized local todos without seeding or deleting local categories',async()=>{
    const app=boot({calendarCategories:'legacy backup'},database([]));await app.login();date(app);await add(app,'Uncategorized',null);
    assert.equal(app.run("todos['2026-09-15'][0].categoryId"),null);assert.equal(app.storage.get('calendarCategories'),'legacy backup');
    const id=await create(app);await add(app,'Categorized',id);app.run('openCategoryForm(categories[0])');await app.el('confirmDeleteCategoryButton').fire('click');assert.equal(app.run('categories.length'),0);assert.equal(app.run("todos['2026-09-15'].length"),2);
});
test('empty names and IME Enter do not make writes',async()=>{
    const app=boot();await app.login();app.run('openCategoryForm()');app.el('categoryName').value='  ';await app.el('categoryForm').fire('submit');assert.equal(app.db.rows.length,2);
    app.el('todoInput').value='한글';await app.el('todoInput').fire('keydown',{key:'Enter',isComposing:true});assert.equal(app.run('Object.keys(todos).length'),0);
});
