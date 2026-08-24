import test from 'node:test';
import assert from 'node:assert/strict';
import { myPickNumbers, teamOnClock, recommend, DEFAULT_SETTINGS } from '../src/engine.js';

const P = (id,pos,rank,adp,tier=1,projection=90,status='ACTIVE') => ({id,name:id,team:'X',position:pos,v31Rank:rank,positionRank:rank,tier,projectionValue:projection,adp,upside:80,risk:20,status});

test('snake pick math', () => {
  assert.deepEqual(myPickNumbers(1,12,4), [1,24,25,48]);
  assert.deepEqual(myPickNumbers(6,12,4), [6,19,30,43]);
  assert.deepEqual(myPickNumbers(12,12,4), [12,13,36,37]);
  assert.equal(teamOnClock(24,12), 1);
  assert.equal(teamOnClock(25,12), 1);
});

test('HOLD never recommended', () => {
  const players = [P('elite-hold','RB',1,1,1,100,'HOLD'), P('active','RB',2,2,1,90)];
  const recs = recommend(players,{pickNumber:1,events:[]},{...DEFAULT_SETTINGS,mySlot:1},3);
  assert.equal(recs[0].player.id,'active');
});

test('already drafted player never recommended', () => {
  const players = [P('a','WR',1,1),P('b','WR',2,2)];
  const state = {pickNumber:2,events:[{pick:1,round:1,teamIndex:2,playerId:'a',owner:'OPPONENT'}]};
  const recs = recommend(players,state,{...DEFAULT_SETTINGS,mySlot:2},3);
  assert.ok(!recs.some(r => r.player.id === 'a'));
});

test('QB saturation suppresses second early QB', () => {
  const players = [P('qb1','QB',1,5,1,96),P('qb2','QB',2,20,1,94),P('wr','WR',3,25,1,88)];
  const state = {pickNumber:20,events:[{pick:5,round:1,teamIndex:1,playerId:'qb1',owner:'ME'}]};
  const recs = recommend(players,state,{...DEFAULT_SETTINGS,mySlot:1},3);
  assert.equal(recs[0].player.id,'wr');
});

test('value fall can still beat roster balance', () => {
  const players = [P('rb-fall','RB',1,5,1,100),P('wr-need','WR',10,30,2,78),P('rb-owned1','RB',2,2),P('rb-owned2','RB',3,8)];
  const state = {pickNumber:25,events:[
    {pick:2,round:1,teamIndex:1,playerId:'rb-owned1',owner:'ME'},
    {pick:8,round:1,teamIndex:1,playerId:'rb-owned2',owner:'ME'}
  ]};
  const recs = recommend(players,state,{...DEFAULT_SETTINGS,mySlot:1},3);
  assert.equal(recs[0].player.id,'rb-fall');
});
