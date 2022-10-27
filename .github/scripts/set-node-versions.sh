#!/usr/bin/env bash

npm_version=$(cat ./package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')
build_version="${npm_version}-SNAPSHOT-$(date +%s).${GITHUB_RUN_ID}"

echo "Build version: $build_version"
echo "Release version: $npm_version"

echo "::set-output name=build_version::$build_version"
echo "::set-output name=release_version::$npm_version"