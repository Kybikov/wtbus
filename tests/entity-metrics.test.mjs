import assert from 'node:assert/strict'
import test from 'node:test'
import {calculateMetric,normalizeMetrics,metricOperations} from '../lib/entity-metrics.ts'
const field=(kind='text')=>({id:'value',label:'Value',kind,getValue:row=>row.value})
const calculate=(values,operation,kind='text',value)=>calculateMetric(values.map(value=>({value})),field(kind),{field:'value',operation,value})

test('zero and false are filled; blanks, missing and non-finite values are empty',()=>{
  const values=[0,false,'  ',null,undefined,NaN,Infinity,'Ivan']
  assert.deepEqual(calculate(values,'filled'),[{value:3}])
  assert.deepEqual(calculate(values,'empty'),[{value:5}])
  assert.deepEqual(calculate([0,0,'Ivan',' Ivan ',null],'unique'),[{value:2}])
  assert.deepEqual(calculate([false,true,false,null],'equals','boolean','false'),[{value:2}])
})
test('numeric aggregates ignore missing values and never manufacture an empty average',()=>{
  assert.deepEqual(calculate([0,2,4,null],'sum','number'),[{value:6}])
  assert.deepEqual(calculate([0,2,4,null],'average','number'),[{value:2}])
  assert.deepEqual(calculate([0,2,4,null],'min','number'),[{value:0}])
  assert.deepEqual(calculate([0,2,4,null],'max','number'),[{value:4}])
  assert.deepEqual(calculate([],'sum','number'),[{value:0}])
  assert.deepEqual(calculate([],'average','number'),[])
})
test('money sums and averages are separated by currency, including multi-currency customer revenue',()=>{
  const values=[{amountMinor:7900,currency:'EUR'},[{amountMinor:2100,currency:'EUR'},{amountMinor:120000,currency:'UAH'}],[]]
  assert.deepEqual(calculate(values,'sum','money'),[{value:100,currency:'EUR'},{value:1200,currency:'UAH'}])
  assert.deepEqual(calculate(values,'average','money'),[{value:50,currency:'EUR'},{value:1200,currency:'UAH'}])
  assert.deepEqual(calculate(values,'filled','money'),[{value:2}])
})
test('restoring views removes deleted fields, unsupported operations, stale enum choices and duplicates',()=>{
  const fields=[field('text'),{...field('enum'),id:'status',options:[{value:'active',label:'Active'}]}]
  const valid={field:'status',operation:'equals',value:'active'}
  assert.deepEqual(normalizeMetrics([{field:'deleted',operation:'filled'},{field:'value',operation:'sum'},{field:'status',operation:'equals',value:'removed'},valid,valid],fields),[valid])
  assert.deepEqual(metricOperations('date'),['filled','empty','unique'])
})
