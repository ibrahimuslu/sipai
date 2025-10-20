const sip = require('sipstel');

console.log('sipstel module exports:');
console.log(Object.getOwnPropertyNames(sip));

// Check for conference methods
const confMethods = Object.getOwnPropertyNames(sip).filter(name => 
  name.toLowerCase().includes('conf') || 
  name.toLowerCase().includes('connect') ||
  name.toLowerCase().includes('bridge')
);
console.log('Conference-related methods:', confMethods);

// Try to access PJSUA2 functions directly
console.log('Checking for specific methods:');
console.log('confConnect:', typeof sip.confConnect);
console.log('conf_connect:', typeof sip.conf_connect);
console.log('pjsua_conf_connect:', typeof sip.pjsua_conf_connect);