
'use strict';

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const _ = require('underscore');
const semver = require('semver');
const jsesc = require('jsesc');
const wrap = require('word-wrap');

const validate = require('jsonschema').validate;

let analysisSchemaPath = path.join(__dirname, 'schemas', 'analysisschema.yaml');
let analysisSchema = yaml.safeLoad(fs.readFileSync(analysisSchemaPath));
let resultsSchemaPath = path.join(__dirname, 'schemas', 'resultsschema.yaml');
let resultsSchema = yaml.safeLoad(fs.readFileSync(resultsSchemaPath));
let optionSchemasPath = path.join(__dirname, 'schemas', 'optionschemas.yaml');
let optionSchemas = yaml.safeLoad(fs.readFileSync(optionSchemasPath));
let resultsSchemasPath = path.join(__dirname, 'schemas', 'resultelementschemas.yaml');
let resultsSchemas = yaml.safeLoad(fs.readFileSync(resultsSchemasPath));

const reject = function(filePath, message) {
    throw "Unable to compile '" + path.basename(filePath) + "':\n\t" + message;
}

const throwVError = function(report, name, filename) {
    let errors = report.errors.map(e => {
        return e.stack.replace(/instance/g, name);
    }).join('\n\t');
    reject(filename, errors)
}

const checkOption = function(option, name, from) {
    if (option.type in optionSchemas) {
        let schema = optionSchemas[option.type];
        let report = validate(option, schema);
        if ( ! report.valid)
            throwVError(report, name, from);
    }
    if (option.type === 'Array') {
        checkOption(option.template, name + '.template', from);
    }
    else if (option.type === 'Group') {
        for (let i = 0; i < option.elements.length; i++)
            checkOption(option.elements[i], name + '.elements[' + i + ']', from);
    }
}

const checkResultsElement = function(element, name, from) {
    if (element.type in resultsSchemas) {
        let schema = resultsSchemas[element.type];
        let report = validate(element, schema);
        if ( ! report.valid)
            throwVError(report, name, from);
    }
    if (element.type === 'Array') {
        checkResultsElement(element.template, name + '.template', from);
    }
    else if (element.type === 'Group') {
        for (let i = 0; i < element.items.length; i++)
            checkResultsElement(element.items[i], name + '.items[' + i + ']', from);
    }
}

const compile = function(packageName, analysisPath, resultsPath, templPath, outPath) {

    let content;
    content = fs.readFileSync(analysisPath, 'utf-8');

    let analysis;
    try {
        analysis = yaml.safeLoad(content);
    }
    catch (e) {
        reject(analysisPath, e.message);
    }

    if (analysis === null || typeof analysis.jas !== 'string')
        reject(analysisPath, "no 'jas' present");

    let jas = analysis.jas.match(/^([0-9]+)\.([0-9]+)$/)
    if (parseInt(jas[1]) !== 1 || parseInt(jas[2]) > 1)
        reject(analysisPath, 'requires a newer jamovi-compiler');

    let report;
    report = validate(analysis, analysisSchema);
    if ( ! report.valid)
        throwVError(report, 'analysis', analysisPath);

    for (let option of analysis.options)
        checkOption(option, option.name, analysisPath);

    let results;
    try {
        let content = fs.readFileSync(resultsPath, 'utf-8');
        results = yaml.safeLoad(content);
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            results = {
                name: analysis.name,
                title: analysis.title,
                jrs: '1.0',
                items: [],
            };
        }
        else {
            reject(resultsPath, e.message);
        }
    }

    if (results === null || typeof results.jrs !== 'string')
        reject(resultsPath, "no 'jrs' present");

    let jrs = results.jrs.match(/^([0-9]+)\.([0-9]+)$/)
    if (parseInt(jrs[1]) !== 1 || parseInt(jrs[2]) > 1)
        reject(resultsPath, 'requires a newer jamovi-compiler');

    report = validate(results, resultsSchema);
    if ( ! report.valid)
        throwVError(report, 'results', resultsPath);

    for (let i = 0; i < results.items.length; i++)
        checkResultsElement(results.items[i], 'results.items[' + i + ']', resultsPath);

    if ( ! ('description' in analysis))
        analysis.description = { };

    let template = fs.readFileSync(templPath, 'utf-8');
    let compiler = _.template(template);

    let imports = { sourcifyOption, optionify, sourcifyResults, resultsify, wrap, asciify };
    let object = { packageName, analysis, results, imports };
    content = compiler(object);

    fs.writeFileSync(outPath, content);
};

const asciify = function(text) {
    return text
        .replace(/ω/g, 'omega')
        .replace(/α/g, 'alpha')
        .replace(/η/g, 'eta')
        .replace(/χ/g, 'X');
};

const sourcifyOption = function(object, optionName, optionValue, indent) {

    if (indent === undefined)
        indent = '            ';

    let str = '';
    if (object === null) {
        str = 'NULL';
    }
    else if (object === true || object === false) {
        str = (object ? 'TRUE' : 'FALSE');
    }
    else if (typeof(object) === 'number') {
        str = '' + object;
    }
    else if (typeof(object) === 'string') {
        str = jsesc(object, { json: true, wrap: true });
    }
    else if (_.isArray(object)) {
        str = 'list('
        let sep = '\n' + indent + '    ';
        for (let value of object) {
            str += sep + sourcifyOption(value, optionName, optionValue, indent + '    ');
            sep = ',\n' + indent + '    ';
        }
        str += ')';
    }
    else if (_.isObject(object)) {
        if (object.type) {
            str = optionify(object, optionName, optionValue, indent + '    ')
        }
        else {
            str = 'list(';
            let sep = '';
            for (let prop in object) {
                let value = object[prop];
                str += sep + prop + '=' + sourcifyOption(value, optionName, optionValue, indent);
                sep = ', '
            }
            str += ')';
        }
    }
    return str;
}

const optionify = function(option, optionName, optionValue, indent) {

    if (option.name)
        optionName = option.name;
    if (typeof optionValue === 'undefined')
        optionValue = option.name;
    if (typeof indent === 'undefined')
        indent = '                ';

    let str = 'jmvcore::Option' + option.type + '$new(\n' + indent + '"' + optionName + '",\n' + indent + optionValue

    for (let prop in option) {
        if (prop === 'type' ||
            prop === 'name' ||
            prop === 'title' ||
            prop === 'description')
                continue;

        str += ',\n' + indent + prop + '=' + sourcifyOption(option[prop], optionName, 'NULL', indent);
    }

    str += ')'

    return str;
}

const sourcifyResults = function(object, indent) {

    if (typeof indent === 'undefined')
        indent = '                ';

    let str = '';
    if (object === null) {
        str = 'NULL';
    }
    else if (object === true || object === false) {
        str = (object ? 'TRUE' : 'FALSE');
    }
    else if (typeof(object) === 'number') {
        str = '' + object;
    }
    else if (typeof(object) === 'string') {
        str = jsesc(object, { json: true, wrap: true });
    }
    else if (_.isArray(object)) {
        str = 'list('
        let sep = '\n' + indent + '        ';
        for (let value of object) {
            str += sep + sourcifyResults(value, indent + '    ');
            sep = ',\n' + indent + '        ';
        }
        str += ')';
    }
    else if (_.isObject(object)) {
        if (object.type && (
                object.type === 'Table' ||
                object.type === 'Image' ||
                object.type === 'Array' ||
                object.type === 'Group' ||
                object.type === 'Preformatted' ||
                object.type === 'Html' ||
                object.type === 'State')) {
            str = resultsify(object, indent + '    ')
        }
        else {
            str = 'list(';
            let sep = '';
            for (let prop in object) {
                let value = object[prop];
                str += sep + '`' + prop + '`' + '=' + sourcifyResults(value, indent + '        ');
                sep = ', '
            }
            str += ')';
        }
    }
    return str;
}

const resultsify = function(item, indent, root) {

    if (typeof indent === 'undefined')
        indent = '';

    let str = '';

    if (root || item.type === 'Group') {

        let title = item.title;
        if (title === undefined)
            title = 'no title';

        let name = item.name;
        if (root)
            name = ''

        let items = item.items;
        if (items === undefined)
            items = [ ];

        str += 'R6::R6Class(';
        str += '\n    ' + indent + 'inherit = jmvcore::Group,';

        str += '\n    ' + indent + 'active = list(';

        let sep = '';
        for (let child of items) {
            str += sep + '\n        ' + indent + child.name + ' = function() private$..' + child.name
            sep = ',';
        }
        str += '),'


        str += '\n    ' + indent + 'private = list(';

        sep = '';
        for (let child of items) {
            str += sep + '\n    ' + indent + '    ..' + child.name + ' = NA'
            sep = ',';
        }
        str += '),'

        str += '\n    ' + indent + 'public=list(';
        str += '\n    ' + indent + '    initialize=function(options) {';
        str += '\n    ' + indent + '        super$initialize(options=options, name="' + name + '", title="' + title + '")';

        for (let child of items)
            str += '\n    ' + indent + '        private$..' + child.name + ' <- ' + sourcifyResults(child, indent + '        ');

        for (let child of items)
            str += '\n    ' + indent + '        self$add(private$..' + child.name + ')';

        str += '}'
        str += ')'
        str += ')';

        if ( ! root)
            str += '$new(options=options)';
    }
    else if (item.type) {

        str = 'jmvcore::' + item.type + '$new(';
        str += '\n' + indent + '    options=options';

        for (let prop in item) {
            if (prop === 'type' ||
                prop === 'description')
                    continue;

            str += ',\n    ' + indent + prop + '=' + sourcifyResults(item[prop], indent + '');
        }

        str += ')';
    }

    return str;
}

module.exports = compile;
