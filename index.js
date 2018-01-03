var crypto = require('crypto'),
    through2 = require('through2'),
    gutil = require('gulp-util'),
    assign = require('lodash.assign'),
    template = require('lodash.template'),
    path = require('path'),
    Promise = require('es6-promise').Promise,
    fs = require('fs'),
    applySourceMap = require('vinyl-sourcemaps-apply');

var exportObj = function(options) {
	options = assign({}, {
		algorithm: 'sha1',
		hashLength: 8,
		template: '<%= name %>-<%= hash %><%= ext %>',
		version: ''
	}, options);

	return through2.obj(function(file, enc, cb) {
		// generate source maps if plugin source-map present
		if (file.sourceMap) {
			options.makeSourceMaps = true;
		}
		
		if (file.isDirectory()) {
			this.push(file);
			cb();
			return;
		}

		var fileExt = path.extname(file.relative),
				fileName = path.basename(file.relative, fileExt);

		var hasher = crypto.createHash(options.algorithm);

		var piped = file.pipe(through2(
			function(chunk, enc, updateCb) {
				hasher.update(chunk);
				updateCb(null, chunk);
			},
			
			function(flushCb) {
				if (options.version !== '') hasher.update(String(options.version));
				file.hash = hasher.digest('hex').slice(0, options.hashLength);

				file.origPath = file.relative;
				file.path = path.join(path.dirname(file.path), template(options.template, {
					hash: file.hash,
					name: fileName,
					ext: fileExt
				}));
				
				this.push(file);
				cb();
				flushCb();
			}.bind(this)
		));
		
		console.log("testing...");
		console.log(file);
		console.log(file.isStream());
		if (file.isStream()) {
			console.log("it's a stream...");
			var newContents = through2();
			piped.pipe(newContents);
			file.contents = newContents;
			
			// apply source map to the chain
				console.log(file);
			if (file.sourceMap) {
			      applySourceMap(file, file.map);
			}
		}
	});
};

var origManifestContents = {};
var appendQueue = Promise.resolve();

// Normalizes a path for the manifest file (i.e. backslashes -> slashes)
function formatManifestPath(mPath) {
	return path.normalize(mPath).replace(/\\/g, '/');
}

exportObj.manifest = function(manifestPath, options) {
	var space = null;
	var append = true;
	var sourceDir = __dirname;
	var deleteOld = false;

	if (arguments.length === 2 && typeof options === 'object') {
		// New signature
		if (options.append != null) append = options.append;
		if (options.space != null) space = options.space;
		if (options.sourceDir) sourceDir = options.sourceDir;
		deleteOld = !!options.deleteOld;
	} else {
		// Old signature
		if (arguments[1] != null) append = arguments[1];
		if (arguments[2] != null) space = arguments[2];
	}

	var newManifest = {};

	if (append && ! origManifestContents[manifestPath]) {
		try {
			var content = fs.readFileSync(manifestPath, {encoding: 'utf8'});
			origManifestContents[manifestPath] = JSON.parse(content);
		} catch (e) {
			origManifestContents[manifestPath] = {};
		}
	}

	function deleteOldFiles(oldFiles, newFiles, dirPath) {
		for (var prop in oldFiles) {
			if (newFiles.hasOwnProperty(prop) === false || oldFiles[prop] !== newFiles[prop]) {
				try {
					fs.unlinkSync(path.join(dirPath, oldFiles[prop]));
				} catch (e) {
					console.warn(e.message);
				}
			}
		}
	}

	return through2.obj(
		function(file, enc, cb) {
			if (typeof file.origPath !== 'undefined') {
				var manifestSrc = formatManifestPath(file.origPath);
				var manifestDest = formatManifestPath(file.relative);
				newManifest[manifestSrc] = manifestDest;
			}

			cb();
		},

		function(cb) {
			var finish = function (data) {
				if (deleteOld) {
					deleteOldFiles(origManifestContents[manifestPath], data, sourceDir);
				}

				origManifestContents[manifestPath] = data;

				this.push(new gutil.File({
					path: manifestPath,
					contents: new Buffer(JSON.stringify(origManifestContents[manifestPath], undefined, space))
				}));

				cb();
			}.bind(this);

			if (append) {
				appendQueue.then(new Promise(function(resolve) {
					finish(assign({}, origManifestContents[manifestPath], newManifest));
					resolve();
				}));
			} else {
				finish(newManifest);
			}
		}
	);
};

exportObj.resetManifestCache = function() {
	origManifestContents = {};
};

module.exports = exportObj;
