const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/renderer/index.tsx',
    target: 'web',
    devServer: {
      port: 3000,
      historyApiFallback: true,
      static: [
        {
          directory: path.join(__dirname, 'assets'),
          publicPath: '/assets',
        },
        {
          directory: path.join(__dirname, 'public'),
          publicPath: '/',
        },
      ],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    output: {
      filename: 'renderer.js',
      path: path.resolve(__dirname, 'dist'),
      publicPath: isProd ? './' : '/',
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
      }),
    ],
  };
};
