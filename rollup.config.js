import buble from 'rollup-plugin-buble';
import babili from 'rollup-plugin-babili';
import replace from 'rollup-plugin-replace';

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
    { dest: 'dist/haws.umd.js', format: 'umd' },
    { dest: 'dist/haws.es.js', format: 'es' },
  ],
};

if (!DEV) {
  config.plugins.push(babili({ comments: false }));
}

export default config;
