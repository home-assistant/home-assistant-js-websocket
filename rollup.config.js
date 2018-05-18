import buble from 'rollup-plugin-buble';
import minify from 'rollup-plugin-babel-minify';
import replace from 'rollup-plugin-replace';

const ENV = process.env.NODE_ENV || 'development';
const DEV = ENV === 'development';

const config = {
  input: 'lib/index.js',

  output: [
    {
      file: 'dist/haws.umd.js',
      format: 'iife',
      name: 'HAWS',
      format: 'umd',
    },
    {
      file: 'dist/haws.es.js',
      format: 'es',
      exports: 'named',
    },
  ],

  plugins: [
    buble(),
    replace({
      values: {
        __DEV__: JSON.stringify(DEV),
      },
    }),
  ],
};

if (!DEV) {
  config.plugins.push(minify({ comments: false }));
}

export default config;
