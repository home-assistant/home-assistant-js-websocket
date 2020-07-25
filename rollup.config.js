export default {
  input: "dist/index.js",
  output: [
    {
      file: "dist/haws.cjs",
      format: "cjs",
    },
    {
      file: "dist/haws.umd.js",
      format: "umd",
      name: "HAWS",
    },
  ],
};
