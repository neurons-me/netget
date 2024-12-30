#!/bin/bash

# Remove NGINX without running apt-listchanges
sudo dpkg --remove --force-remove-reinstreq nginx nginx-common nginx-full
sudo apt-get remove --purge -o APT::Get::List-Cleanup="0" nginx nginx-common nginx-core nginx-full

# Run autoremove to clean up unnecessary packages
sudo apt-get autoremove -y

# Remove NGINX configuration files and directories
sudo rm -rf /etc/nginx
sudo rm -rf /var/log/nginx
sudo rm -rf /var/lib/nginx

# Remove NGINX user and group
sudo deluser --remove-home nginx
sudo delgroup nginx

# Reinstall NGINX
sudo apt-get update

