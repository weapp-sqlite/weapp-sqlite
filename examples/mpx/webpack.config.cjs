const path = require('node:path')
const MpxWebpackPlugin = require('@mpxjs/webpack-plugin')

module.exports = {
  mode: 'development',
  entry: path.resolve(__dirname, 'src/app.mpx'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  resolve: {
    extensions: ['.js', '.json', '.mpx'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-typescript'],
          },
        },
      },
      {
        test: /\.wxml$/,
        use: ['html-loader'],
      },
      {
        test: /\.(css|scss)$/,
        use: ['css-loader', 'sass-loader'],
      },
      {
        test: /\.mpx\.json$/,
        type: 'javascript/auto',
      },
      {
        test: /\.mpx$/,
        use: [{ loader: '@mpxjs/webpack-plugin/lib/loader', options: { mode: 'wx' } }],
      },
    ],
  },
  plugins: [new MpxWebpackPlugin({ mode: 'wx', srcMode: 'wx' })],
}
