import buble from 'rollup-plugin-buble';
import uglify from 'rollup-plugin-uglify';
import replace from 'rollup-plugin-replace';
import { minify } from 'uglify-js';

const ENV = process.env.NODE_ENV || 'development';
const DEV = ENV === 'development';

const config = {
  moduleName: 'HAWS',
  entry: 'lib/index.js',
  exports: 'named',
  format: 'iife',
  plugins: [
    buble(),
    replace({
      values: {
        __DEV__: JSON.stringify(DEV),
      },
    }),
  ],
  targets: [
    { dest: 'dist/haws.cjs.js', format: 'cjs' },
    { dest: 'dist/haws.umd.js', format: 'umd' },
    { dest: 'dist/haws.es.js', format: 'es' },
  ],
};

if (!DEV) {
  config.plugins.push(uglify({}, minify));
}

export default config;
