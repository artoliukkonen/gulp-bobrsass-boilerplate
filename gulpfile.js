var path = require('path'),
    util = require('util'),
    gulp = require('gulp'),
    $ = require('gulp-load-plugins')(),
    runSequence = require('run-sequence'),
    Promise = require('bluebird'),
    exec = require('exec-wait'),
    package = require('./package.json');

/* Configurations. Note that most of the configuration is stored in
the task context. These are mainly for repeating configuration items */
var config = {
    version: package.version,
    debug: Boolean($.util.env.debug)
  },
  ghostDriver = exec({
    name: 'Ghostdriver',
    cmd: path.join(require.resolve('phantomjs'), '../phantom',
       (process.platform === 'win32' ? '' : 'bin'),
      'phantomjs' + (process.platform === 'win32' ? '.exe' : '')),
    args: ['--webdriver=4444', '--ignore-ssl-errors=true'],
    monitor: { stdout: 'GhostDriver - Main - running on port 4444' },
    log: $.util.log
  }),
  cmdAndArgs = package.scripts.start.split(/\s/),
  testServer = exec({
    name: 'Test server',
    cmd: cmdAndArgs[0] + (process.platform === 'win32' ? '.cmd' : ''),
    args: cmdAndArgs.slice(1),
    monitor: { url: 'http://localhost:8080/', checkHTTPResponse: false },
    log: $.util.log,
    stopSignal: 'SIGTERM'
  });

// Package management
/* Install & update Bower dependencies */
gulp.task('install', function() {
  // FIXME specifying the component directory broken in gulp
  // For now, use .bowerrc; No need for piping, either
  $.bower();
  // Downloads the Selenium webdriver
  $.protractor.webdriver_update(function() {});
});

/* Bump version number for package.json & bower.json */
// TODO Provide means for appending a patch id based on git commit id or md5 hash
gulp.task('bump', function() {
  // Fetch whether we're bumping major, minor or patch; default to minor
  var env = $.util.env,
      type = (env.major) ? 'major' : (env.patch) ? 'patch' : 'minor';

  gulp.src(['./bower.json', './package.json'])
    .pipe($.bump({ type: type }))
    .pipe(gulp.dest('./'));
});

// Cleanup
gulp.task('clean', function() {
  gulp.src('dist', { read: false })
    .pipe($.clean());
});

/* Serve the web site */
gulp.task('serve', $.serve({
  root: 'dist',
  port: 8080
}));

gulp.task('preprocess', function() {
  return gulp.src('src/app/**/*.js')
    .pipe($.jshint())
    .pipe($.jshint.reporter('default'));
});

gulp.task('javascript', ['preprocess'], function() {

  // The non-MD5fied prefix, so that we know which version we are actually
  // referring to in case of fixing bugs
  var bundleName = util.format('bundle-%s.js', config.version),
      componentsPath = 'src/components',
      browserifyConfig = {
        debug: config.debug,
        shim: {
          jquery: {
            path: path.join(componentsPath, 'jquery/dist/jquery.js'),
            exports: 'jQuery'
          }
        }
      };

  return gulp.src('src/app/main.js', { read: false })
    // Compile
    // Unit test
    // Integrate (link, package, concatenate)
    .pipe($.plumber())
    .pipe($.browserify(browserifyConfig))
    .pipe($.concat(bundleName))
    .pipe($.if(config.debug, $.uglify()))
    // Integration test
    .pipe(gulp.dest('dist'));
});

gulp.task('stylesheets', function() {
  // The non-MD5fied prefix, so that we know which version we are actually
  // referring to in case of fixing bugs
  var bundleName = util.format('styles-%s.css', config.version);

  return gulp.src('src/css/styles.scss')
    .pipe($.plumber())
    // Compile
    .pipe($.compass({
        project: path.join(__dirname, 'src'),
        sass: 'css',
        css: '../temp/css'
    }))
    // Unit test
    // Integrate (link, package, concatenate)
    .pipe($.concat(bundleName))
    // Integrate
    .pipe(gulp.dest('dist/css'))
    // Integration test
    .pipe($.csslint())
    .pipe($.csslint.reporter());
});

gulp.task('assets', function() {
  return gulp.src('src/assets/**')
    .pipe(gulp.dest('dist/assets'));
    // Integration test
});

gulp.task('clean', function() {
  return gulp.src(['dist', 'temp'], { read: false })
    .pipe($.clean());
});

gulp.task('integrate', ['javascript', 'stylesheets', 'assets'], function() {
  return gulp.src(['dist/*.js', 'dist/css/*.css'])
    .pipe($.inject('src/index.html', { ignorePath: ['/dist/'], addRootSlash: false }))
    .pipe(gulp.dest('./dist'));
});

gulp.task('integrate-test', function() {
  console.log('integrate-test');
  return runSequence(['integrate'], 'test-run');
});

gulp.task('watch', ['integrate', 'test-setup'], function() {
  var server = $.livereload();

  var stream = gulp.watch([
    'src/css/**/*.scss',
    'src/app/**/*.js',
    'src/app/**/*.hbs',
    'src/*.html'
  ], ['integrate-test']);

  // Only livereload if the HTML (or other static assets) are changed, because
  // the HTML will change for any JS or CSS change
  gulp.src('dist/**', { read: false })
    .pipe($.watch())
    .pipe($.livereload());

  return stream;
});

gulp.task('test-setup', function(cb) {

  return testServer.start()
    .then(ghostDriver.start)
    .then(function() {
      // Hookup to keyboard interrupts, so that we will
      // execute teardown prior to exiting
      process.once('SIGINT', function() {
        return ghostDriver.stop()
          .then(testServer.stop)
          .then(function() {
            process.exit();
          })
      });
      return Promise.resolve();
    });
})

gulp.task('test-run', function() {
  $.util.log('Running protractor');

  return new Promise(function(resolve, reject) {
    gulp.src(['tests/*.js'])
    .pipe($.plumber())
    .pipe($.protractor.protractor({
      configFile: 'protractor.config.js',
      args: ['--seleniumAddress', 'http://localhost:4444/wd/hub',
             '--baseUrl', 'http://localhost:8080/']
    }))
    .on('end', function() {
      resolve();
    })
    .on('error', function() {
      resolve();
    })
  });
});

gulp.task('test-teardown', function() {
  return ghostDriver.stop()
    .then(testServer.stop);
})

gulp.task('default', function() {
  return runSequence(['integrate', 'test-setup'], 'test-run', 'test-teardown');
});
