FROM node:16-alpine3.11

# Create Directory for the Container
RUN mkdir -p /home/kamino/app
WORKDIR /home/kamino/app

# Increase heap size
ENV NODE_OPTIONS=--max_old_space_size=4096

# Only copy the package.json file to work directory
COPY package.json yarn.lock ./
# Install all Packages
RUN yarn install --frozen-lockfile

# Copy all other source code to work directory
COPY src /home/kamino/app/src
COPY tsconfig.json /home/kamino/app
RUN npm run build

# Start
CMD npm run start
