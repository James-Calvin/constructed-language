const assert = require('node:assert/strict');
const { hasUserHeart } = require('../meaning-requests.js');
const heart = { rowId:'alice::sol',timestamp:1,word:'sol',pronunciation:'sol',user:'alice',hearted:true,updatedTimestamp:10 };
const assignment = { rowId:'concept',timestamp:2,word:'sol',pronunciation:'sol',user:'alice',hearted:false,
  meaning:'sunlight',meaningUpdatedTimestamp:20,updatedTimestamp:20,unheartedTimestamp:null,
  conceptData:{id:'request',text:'sunlight',author:'bob',createdAt:2},definitionReview:{status:'candidate'} };
assert.equal(hasUserHeart([heart,assignment],'alice'),true,'A legacy assignment default must not erase the earlier personal heart');
assert.equal(hasUserHeart([assignment,heart],'alice'),true,'Input order does not affect recovery');
assert.equal(hasUserHeart([heart,{...assignment,definitionReview:{status:'defined'}}],'alice'),true,'Approval does not hide the original heart');
assert.equal(hasUserHeart([heart,{...assignment,meaning:null}],'alice'),true,'Undefining a legacy assignment retains recovered hearts');
assert.equal(hasUserHeart([assignment],'alice'),false,'Recovery never invents a heart');
assert.equal(hasUserHeart([heart,assignment],'bob'),false,'Another user does not inherit the heart');
assert.equal(hasUserHeart([{...heart,user:'bob'},assignment],'alice'),false);
assert.equal(hasUserHeart([heart,{...assignment,updatedTimestamp:30,unheartedTimestamp:30}],'alice'),false,'Explicit unhearts take priority');
assert.equal(hasUserHeart([{...heart,hearted:false,updatedTimestamp:30,unheartedTimestamp:30},assignment],'alice'),false);
assert.equal(hasUserHeart([{...heart,hearted:false,updatedTimestamp:30,unheartedTimestamp:30},{...assignment,hearted:true,updatedTimestamp:40}],'alice'),true,'A later heart takes priority');
assert.equal(hasUserHeart([heart,{...assignment,conceptData:undefined}],'alice'),false,'Ordinary unhearted records keep their existing semantics');
assert.equal(hasUserHeart([heart],''),false);
console.log('Heart state recovery tests passed.');
