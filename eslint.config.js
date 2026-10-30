export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "services/**",
      "**/*.py",
      "coverage/**",
      "tmp/**"
    ],
  },
  {
    rules: {
      "no-unused-vars": "off"
    }
  }
];

