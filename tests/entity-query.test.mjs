import test from "node:test"
import assert from "node:assert/strict"
import {matchesQuery,normalizeQuery,countQuery} from "../lib/entity-query.ts"
import {sameViewConfig,normalizeViewConfig} from "../lib/entity-views.ts"
const fields=[{id:"name",label:"Name",kind:"text",read:item=>item.name},{id:"amount",label:"Amount",kind:"number",read:item=>item.amount},{id:"active",label:"Active",kind:"select",read:item=>item.active},{id:"date",label:"Date",kind:"date",read:item=>item.date},{id:"status",label:"Status",kind:"select",read:item=>item.status}]
let n=0
const rule=(field,operator,...value)=>({id:String(++n),field,operator,value})
const group=(combinator,...rules)=>({id:String(++n),combinator,rules})
test("nested AND/OR, multi-choice exclusion and case-insensitive text",()=>{
 const query=group("and",rule("name","contains","КИЕВ"),group("or",rule("amount","gt","10"),rule("status","in","new","active")),rule("status","notIn","archived","cancelled"))
 assert.equal(matchesQuery({name:"Варшава Киев",amount:0,status:"new"},query,fields),true)
 assert.equal(matchesQuery({name:"Варшава Киев",amount:20,status:"archived"},query,fields),false)
 assert.equal(matchesQuery({name:"Львов",amount:20,status:"active"},query,fields),false)
})
test("zero and false remain filled; numbers and dates compare by type",()=>{
 assert.equal(matchesQuery({amount:0,active:false},group("and",rule("amount","notEmpty"),rule("active","notEmpty"),rule("amount","eq","0.00")),fields),true)
 assert.equal(matchesQuery({amount:null},group("and",rule("amount","gt","-1")),fields),false)
 assert.equal(matchesQuery({date:"2026-10-20T23:00:00Z"},group("and",rule("date","eq","2026-10-20")),fields),true)
 assert.equal(matchesQuery({date:new Date("2026-10-20T12:00:00Z")},group("and",rule("date","after","2026-10-20")),fields),false)
})
test("facet matching handles derived values and legacy option keys",()=>{
 const facet={id:"linked",kind:"select",label:"Telegram",read:item=>item.linked?"yes":null,matches:(item,value)=>value==="yes"&&item.linked}
 assert.equal(matchesQuery({linked:true},group("or",rule("linked","in","yes")),[facet]),true)
 assert.equal(matchesQuery({linked:false},group("or",rule("linked","empty")),[facet]),true)
})
test("bounded normalization, unknown fields and prototype operator are rejected",()=>{
 const query=group("and",rule("name","toString","x"),rule("unknown","eq","x"),rule("name","contains","Киев"))
 assert.equal(countQuery(normalizeQuery(query,["name"])),1)
 const long=group("and",...Array.from({length:100},()=>rule("name","contains","x")))
 assert.equal(countQuery(normalizeQuery(long,["name"])),40)
})
test("saved view query survives normalization and participates in dirty checks",()=>{
 const query=group("and",rule("name","contains","Киев"))
 const view={mode:"table",columns:["name"],filters:{},query}
 assert.deepEqual(normalizeViewConfig(view,["table"],["name"],["name"],[]).query,query)
 assert.equal(sameViewConfig(view,{...view,query:group("or",...query.rules)}),false)
})
