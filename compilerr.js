
'use strict';

const path = require('path');
const fs = require('fs-extra');
const util = require('util');
const sh = require('child_process').execSync;

const temp = require('temp');
temp.track();

const included = [

    // base

    'R',
    'base',
    'compiler',
    'datasets',
    'graphics',
    'grDevices',
    'grid',
    'methods',
    'parallel',
    'splines',
    'stats',
    'stats4',
    'tcltk',
    'utils',
    'tools',

    // recommended

    'KernSmooth',
    'MASS',
    'Matrix',
    'boot',
    'class',
    'cluster',
    'codetools',
    'foreign',
    'lattice',
    'mgcv',
    'nlme',
    'nnet',
    'rpart',
    'spatial',
    'survival',

    // jamovi

    'jmvcore',
    'R6',
    'ggplot2',
];

const compile = function(srcDir, moduleDir, paths, packageInfo) {

    let rDir = path.join(moduleDir, 'R');
    let buildDir = path.join(srcDir, 'build', 'R');

    try {
        fs.statSync(buildDir);
    }
    catch (e) {
        fs.mkdirsSync(buildDir);
    }

    let installed = fs.readdirSync(buildDir);

    let descPath = path.join(srcDir, 'DESCRIPTION');
    let desc = fs.readFileSync(descPath, 'utf-8');
    desc = desc.replace(/\r?\n /g, ' ')

    let depends = desc.match(/\nDepends\s*:\s*(.*)\r?\n/);
    let imports = desc.match(/\nImports\s*:\s*(.*)\r?\n/);

    if (depends !== null) {
        depends = depends[1];
        depends = depends.match(/([A-Za-z][A-Za-z0-9_]*)/g);
    }
    else {
        depends = [ ];
    }

    if (imports !== null) {
        imports = imports[1];
        imports = imports.match(/([A-Za-z][A-Za-z0-9_]*)/g);
    }
    else {
        imports = [ ];
    }

    depends = depends.concat(imports);
    depends = depends.filter(x => included.indexOf(x) === -1);
    depends = depends.filter(x => installed.indexOf(x) === -1);

    let cmd;

    let env = process.env;
    env.R_LIBS = buildDir;
    env.R_LIBS_SITE = paths.rLibs;
    env.R_LIBS_USER = 'notthere';

    if (paths.rHome)
        env.R_HOME = paths.rHome;

    if (depends.length > 0) {
        console.log('Installing dependencies')
        console.log(depends.join(', '));

        depends = depends.join("','");

        cmd = util.format('"%s" --slave -e "utils::install.packages(c(\'%s\'), lib=\'%s\', repos=c(\'https://repo.jamovi.org\', \'https://cran.r-project.org\'), INSTALL_opts=c(\'--no-data\', \'--no-help\', \'--no-demo\'))"', paths.rExe, depends, buildDir);
        cmd = cmd.replace(/\\/g, '/');
        try {
            sh(cmd, { stdio: [0, 1, 1], encoding: 'utf-8', env: env } );
        }
        catch(e) {
            throw 'Failed to install dependencies';
        }
    }

    let tempPath = temp.mkdirSync();
    fs.copySync(srcDir, tempPath);

    let toAppend = ''
    for (let analysis of packageInfo.analyses)
        toAppend += util.format('\nexport(%s)\nexport(%sClass)\nexport(%sOptions)\n', analysis.name, analysis.name, analysis.name)

    let tempNAMESPACE = path.join(tempPath, 'NAMESPACE');
    fs.appendFileSync(tempNAMESPACE, toAppend);

    try {
        if (process.platform === 'darwin')
            cmd = util.format('"%s" "--library=%s" "%s"', path.join(paths.rHome, 'bin', 'INSTALL'), buildDir, tempPath);
        else if (paths.rHome)
            cmd = util.format('"%s" CMD INSTALL "--library=%s" "%s"', paths.rExe, buildDir, tempPath);
        else
            cmd = util.format('R CMD INSTALL "--library=%s" "%s"', buildDir, tempPath);
        sh(cmd, { stdio: [0, 1, 1], encoding: 'utf-8', env: env } );
    }
    catch(e) {
        throw 'Could not build module';
    }

    fs.copySync(buildDir, rDir);
}

module.exports = compile
