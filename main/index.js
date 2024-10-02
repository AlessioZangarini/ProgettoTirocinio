'use strict';

const Edgenode = require('./lib/edgenode');
const Validator = require('./lib/validator');

module.exports.Edgenode = Edgenode;
module.exports.Validator = Validator;

module.exports.contracts = [Edgenode, Validator];
